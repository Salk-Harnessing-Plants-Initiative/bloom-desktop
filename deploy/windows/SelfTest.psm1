# SelfTest.psm1: the installed app's upload self-test. After installing, the deploy runs
# the new version's --deploy-self-test on a copy of bloom.db, which uploads a 3-frame
# synthetic scan to Bloom; then it waits for the app's helper processes to exit so they
# are never taken for an operator opening Bloom Desktop.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

# Without -Force: reuse the instances BloomDeploy.psm1 loaded (log redactions, stages).
Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1')
Import-Module (Join-Path $PSScriptRoot 'DeployStages.psm1')

# The app's own time limit is 180 s; this is the backstop if the process hangs.
$script:SelfTestTimeoutSeconds = 240
# Electron's helper processes can outlive the main one by a moment after the self-test.
$script:SelfTestExitWaitSeconds = 15
$script:SelfTestPollMilliseconds = 500
# The first release whose app has --deploy-self-test.
$script:SelfTestMinVersion = [version]'0.2.1'
# 0x80000003 (STATUS_BREAKPOINT) as a signed or unsigned exit code: Chromium couldn't start.
$script:ChromiumStartupCrashCodes = @(-2147483645, 2147483651)

function Wait-SelfTestProcessesExit {
    <#
      Wait for the self-test's helper processes (same exe as the app) to exit, then stop any
      left, so the deploy never takes them for an operator opening Bloom Desktop.
    #>
    param(
        [Parameter(Mandatory)][int]$ParentId,
        [int]$TimeoutSeconds = $script:SelfTestExitWaitSeconds
    )
    $filter = "ParentProcessId = $ParentId AND Name = 'Bloom Desktop.exe'"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        $left = @(Get-CimInstance -ClassName Win32_Process -Filter $filter -ErrorAction SilentlyContinue)
        if ($left.Count -eq 0) { return }
        if ((Get-Date) -ge $deadline) { break }
        Start-Sleep -Milliseconds $script:SelfTestPollMilliseconds
    }
    Write-DeployLog "Stopping $($left.Count) self-test process(es) that did not exit."
    foreach ($child in $left) { Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue }
    Wait-Process -Id ($left | ForEach-Object { $_.ProcessId }) -Timeout $TimeoutSeconds -ErrorAction SilentlyContinue
}

function Get-ResultValue {
    <# A field of the app's result file, or $null when an older app didn't write it. #>
    param($Result, [string]$Name)
    if ($Result.PSObject.Properties[$Name]) { $Result.$Name } else { $null }
}

function Invoke-DeploySelfTest {
    <#
      Run the installed app's --deploy-self-test on a copy of bloom.db: it uploads a
      3-frame synthetic scan to Bloom (experiment DEPLOY-TEST <scanner>). Returns
      Status (passed | failed | not-supported), Detail, PlantId and Problems.
    #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$LocalAppData,
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$Species,
        [Parameter(Mandatory)][string]$WorkDir
    )
    if ((Get-ReleaseBaseVersion -Version $Version) -lt $script:SelfTestMinVersion) {
        return [pscustomobject]@{ Status = 'not-supported'; Detail = "v$Version has no self-test (added in $($script:SelfTestMinVersion))"; PlantId = $null; Problems = @() }
    }
    # The versioned exe, not the Squirrel launcher in the folder above, which exits at once.
    $exe = Join-Path $LocalAppData "bloom_desktop\app-$(ConvertTo-SquirrelVersion -Version $Version)\Bloom Desktop.exe"
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $copy = Join-Path $WorkDir 'self-test-copy.db'
    $resultFile = Join-Path $WorkDir 'self-test-result.json'
    Remove-Item -LiteralPath $copy, $resultFile -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath (Join-Path $ProfileDir '.bloom\data\bloom.db') -Destination $copy
    Write-DeployLog "Running the installed app's upload self-test (species $Species) on a copy of the database."

    try {
        $arguments = @('--deploy-self-test', "--database=`"$copy`"", "--species=`"$Species`"", "--result-file=`"$resultFile`"")
        $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
        $null = $process.Handle
        if (-not (Wait-ProcessWithProgress -Process $process -TimeoutSeconds $script:SelfTestTimeoutSeconds -What 'the self-test')) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            $process.WaitForExit($script:SelfTestExitWaitSeconds * 1000) | Out-Null
            Wait-SelfTestProcessesExit -ParentId $process.Id
            return [pscustomobject]@{ Status = 'failed'; Detail = 'timed out'; PlantId = $null; Problems = @("Self-test did not finish within $($script:SelfTestTimeoutSeconds) seconds.") }
        }
        Wait-SelfTestProcessesExit -ParentId $process.Id
        if (-not (Test-Path -LiteralPath $resultFile)) {
            $problem = "Self-test wrote no result (exit code $($process.ExitCode))."
            if ($process.ExitCode -in $script:ChromiumStartupCrashCodes) {
                $problem += " The app couldn't start in the runner's session; see 'If the test upload reports that it wrote no result' in docs/STATION_SETUP.md."
            }
            return [pscustomobject]@{ Status = 'failed'; Detail = "exit code $($process.ExitCode)"; PlantId = $null; Problems = @($problem) }
        }
        $result = Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json
        $experiment = Get-ResultValue $result 'experiment'
        $frames = Get-ResultValue $result 'frames'
        $where = if ($experiment) { " in experiment '$experiment'" } else { '' }
        $of = if ($frames) { " of $frames" } else { '' }
        Write-DeployLog "Self-test: plant $($result.plantId)$where, uploaded $($result.uploaded)$of frame(s)."
        foreach ($message in @(Get-ResultValue $result 'errors') | Where-Object { $_ }) { Write-DeployLog "  self-test error: $message" }
        if ($result.ok) {
            return [pscustomobject]@{ Status = 'passed'; Detail = "uploaded $($result.uploaded)$of frames as plant $($result.plantId)$where"; PlantId = $result.plantId; Problems = @() }
        }
        $errors = @($result.errors) -join '; '
        [pscustomobject]@{ Status = 'failed'; Detail = "plant $($result.plantId)$where"; PlantId = $result.plantId; Problems = @("Self-test upload failed: $errors") }
    }
    finally {
        Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
    }
}

Export-ModuleMember -Function Invoke-DeploySelfTest, Wait-SelfTestProcessesExit
