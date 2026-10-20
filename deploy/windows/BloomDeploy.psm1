# BloomDeploy.psm1: install a Bloom Desktop release on a Windows CylinderScan station.
#
# Called by deploy-station.ps1 from the Deploy workflow, on the station's self-hosted
# runner, under the station's lab account (Squirrel installs per user). Every step is a
# small function so it can be tested with Pester on windows-latest using fakes.
#
# Order matters: nothing on the station changes until the release files verify, the app
# is confirmed not running, Bloom accepts the station's login, the installed version's
# files are staged for a rollback, and the backup is verified. A failed install, database
# upgrade, check or upload self-test reinstalls the previous version and restores the
# database and .env from the backup. The checks themselves are in StationChecks.psm1.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1') -Force

# --- Constants -------------------------------------------------------------------------

$script:BackupsKept = 5
$script:MinFreeDiskGB = 20
$script:InstallTimeoutSeconds = 600
$script:DownloadTimeoutSeconds = 600
$script:ProcessName = 'Bloom Desktop'
$script:SquirrelAppFolder = 'bloom_desktop'
$script:MockVariables = @('BLOOM_USE_MOCK_HARDWARE', 'BLOOM_USE_MOCK_CAMERA', 'BLOOM_USE_MOCK_DAQ')
# The app quits on Squirrel's --squirrel-firstrun when this is set, so an install from
# the runner service doesn't start the app (and open the database) in a hidden session.
$script:SkipFirstRunVariable = 'BLOOM_DEPLOY_SKIP_FIRSTRUN'

# --- Small helpers (mocked in tests) ----------------------------------------------------

function Get-UserEnvironmentVariable {
    param([Parameter(Mandatory)][string]$Name)
    [Environment]::GetEnvironmentVariable($Name, 'User')
}

function Get-FreeDiskGB {
    param([Parameter(Mandatory)][string]$Path)
    $drive = (Get-Item -LiteralPath $Path).PSDrive
    [math]::Floor((Get-PSDrive -Name $drive.Name).Free / 1GB)
}

function Test-BloomRunning {
    [bool](Get-Process -Name $script:ProcessName -ErrorAction SilentlyContinue)
}

function Get-FileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# --- Release files -------------------------------------------------------------------

function Save-ReleaseFiles {
    <#
      Download manifest.json, SHA256SUMS and the release's Windows files into $StageDir,
      and check every Windows file against SHA256SUMS. Returns the Setup.exe path.
    #>
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$StageDir
    )
    New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
    foreach ($name in 'manifest.json', 'SHA256SUMS') {
        Invoke-WebRequest -Uri "$BaseUrl/$name" -OutFile (Join-Path $StageDir $name) `
            -UseBasicParsing -TimeoutSec $script:DownloadTimeoutSeconds
    }

    $manifest = Get-Content -Raw -LiteralPath (Join-Path $StageDir 'manifest.json') | ConvertFrom-Json
    $windowsFiles = @($manifest.files | Where-Object { $_.target -eq 'windows' })
    if ($windowsFiles.Count -eq 0) { throw 'The release has no Windows files.' }

    foreach ($file in $windowsFiles) {
        Invoke-WebRequest -Uri "$BaseUrl/$($file.name)" -OutFile (Join-Path $StageDir $file.name) `
            -UseBasicParsing -TimeoutSec $script:DownloadTimeoutSeconds
    }
    Assert-Checksums -StageDir $StageDir -FileNames ($windowsFiles | ForEach-Object { $_.name })

    $setup = @($windowsFiles | Where-Object { $_.name -like '*.exe' })
    if ($setup.Count -ne 1) { throw "Expected one Setup.exe in the release, found $($setup.Count)." }
    Join-Path $StageDir $setup[0].name
}

function Assert-Checksums {
    param(
        [Parameter(Mandatory)][string]$StageDir,
        [Parameter(Mandatory)][string[]]$FileNames
    )
    $expected = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $StageDir 'SHA256SUMS')) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $expected[$Matches[2]] = $Matches[1].ToLowerInvariant() }
    }
    foreach ($name in $FileNames) {
        if (-not $expected.ContainsKey($name)) { throw "$name is not listed in SHA256SUMS." }
        $actual = Get-FileSha256 -Path (Join-Path $StageDir $name)
        if ($actual -ne $expected[$name]) { throw "Checksum mismatch for ${name}: expected $($expected[$name]), got $actual." }
    }
}

# --- Installed state -----------------------------------------------------------------

function Get-InstalledVersion {
    <# Highest app-<version> folder under %LOCALAPPDATA%\bloom_desktop, or $null. #>
    param([Parameter(Mandatory)][string]$LocalAppData)
    $root = Join-Path $LocalAppData $script:SquirrelAppFolder
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $versions = Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' |
        ForEach-Object { $_.Name.Substring(4) } |
        Where-Object { $_ -match '^\d+\.\d+\.\d+$' } |
        Sort-Object { [version]$_ }
    if (-not $versions) { return $null }
    @($versions)[-1]
}

# --- Backup ----------------------------------------------------------------------------

function Backup-StationData {
    <#
      Copy ~/.bloom/data/bloom.db and ~/.bloom/.env into a new timestamped folder and check
      each copy's hash. Returns the backup folder. Missing files (a first install) are
      noted, not an error.
    #>
    param(
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$BackupRoot,
        [string]$OldVersion
    )
    $label = if ($OldVersion) { "v$OldVersion" } else { 'none' }
    $dest = Join-Path $BackupRoot ('{0}_{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $label)
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    $sources = @(
        (Join-Path $ProfileDir '.bloom\data\bloom.db'),
        (Join-Path $ProfileDir '.bloom\.env')
    )
    foreach ($source in $sources) {
        if (-not (Test-Path -LiteralPath $source)) {
            Write-DeployLog "Backup: $source not found, nothing to copy."
            continue
        }
        $target = Join-Path $dest (Split-Path -Leaf $source)
        Copy-Item -LiteralPath $source -Destination $target
        if ((Get-FileSha256 -Path $source) -ne (Get-FileSha256 -Path $target)) {
            throw "Backup copy of $source does not match the original."
        }
        Write-DeployLog "Backup: copied $source"
    }
    $dest
}

function Remove-OldBackups {
    <# Keep the newest $Keep backup folders; never removes $Protect. #>
    param(
        [Parameter(Mandatory)][string]$BackupRoot,
        [int]$Keep = $script:BackupsKept,
        [string]$Protect
    )
    $old = Get-ChildItem -LiteralPath $BackupRoot -Directory | Sort-Object Name -Descending |
        Select-Object -Skip $Keep
    foreach ($dir in $old) {
        if ($Protect -and ($dir.FullName -eq $Protect)) { continue }
        Remove-Item -LiteralPath $dir.FullName -Recurse -Force
        Write-DeployLog "Removed old backup $($dir.Name)"
    }
}

# --- Install, verify, roll back ---------------------------------------------------------

function Install-Release {
    param([Parameter(Mandatory)][string]$SetupExe)
    $previous = [Environment]::GetEnvironmentVariable($script:SkipFirstRunVariable, 'Process')
    [Environment]::SetEnvironmentVariable($script:SkipFirstRunVariable, '1', 'Process')
    try {
        $process = Start-Process -FilePath $SetupExe -ArgumentList '--silent' -PassThru
        # Windows PowerShell only keeps ExitCode if the handle is read while the process runs.
        $null = $process.Handle
        if (-not $process.WaitForExit($script:InstallTimeoutSeconds * 1000)) {
            throw "Setup.exe did not finish within $($script:InstallTimeoutSeconds) seconds."
        }
        if ($process.ExitCode -ne 0) { throw "Setup.exe exited with code $($process.ExitCode)." }
    }
    finally {
        [Environment]::SetEnvironmentVariable($script:SkipFirstRunVariable, $previous, 'Process')
    }
}

function Test-Installation {
    <# Returns a list of problems; empty means the station is ready. #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$ScannerName,
        [Parameter(Mandatory)][string]$LocalAppData,
        [Parameter(Mandatory)][string]$ProfileDir
    )
    $problems = [System.Collections.Generic.List[string]]::new()

    $installed = Get-InstalledVersion -LocalAppData $LocalAppData
    if ($installed -ne $Version) { $problems.Add("Installed version is '$installed', expected '$Version'.") }

    foreach ($name in $script:MockVariables) {
        if ((Get-UserEnvironmentVariable -Name $name) -ne 'false') {
            $problems.Add("User environment variable $name must be 'false' so real hardware is used.")
        }
    }

    $envFile = Join-Path $ProfileDir '.bloom\.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        $problems.Add("$envFile is missing: set up Machine Configuration on the station.")
    }
    else {
        $settings = Read-StationEnv -ProfileDir $ProfileDir
        if ($settings['SCANNER_MODE'] -ne 'cylinderscan') { $problems.Add('SCANNER_MODE in .env must be cylinderscan.') }
        if ($settings['SCANNER_NAME'] -ne $ScannerName) {
            $problems.Add("SCANNER_NAME in .env is '$($settings['SCANNER_NAME'])', expected '$ScannerName'.")
        }
        $cameraIp = $settings['CAMERA_IP_ADDRESS']
        if (-not $cameraIp -or $cameraIp -eq 'mock') { $problems.Add('CAMERA_IP_ADDRESS in .env must be the real camera, not mock or empty.') }
    }

    $freeGB = Get-FreeDiskGB -Path $ProfileDir
    if ($freeGB -lt $script:MinFreeDiskGB) { $problems.Add("Only $freeGB GB free; at least $($script:MinFreeDiskGB) GB is needed for scans.") }

    # Plain values, so callers' @(...) gives an empty array when there are no problems.
    $problems.ToArray()
}

function Invoke-Rollback {
    <# Reinstall $PreviousVersion from its staged release. Squirrel won't downgrade in place. #>
    param(
        [Parameter(Mandatory)][string]$PreviousVersion,
        [Parameter(Mandatory)][string]$ReleasesRoot,
        [Parameter(Mandatory)][string]$LocalAppData
    )
    $stage = Join-Path $ReleasesRoot "v$PreviousVersion"
    $setup = @(Get-ChildItem -LiteralPath $stage -Filter '*.exe' -ErrorAction SilentlyContinue)
    if ($setup.Count -ne 1) { throw "Can't roll back: no staged Setup.exe for v$PreviousVersion in $stage." }

    $update = Join-Path (Join-Path $LocalAppData $script:SquirrelAppFolder) 'Update.exe'
    if (Test-Path -LiteralPath $update) {
        $process = Start-Process -FilePath $update -ArgumentList '--uninstall', '-s' -PassThru
        $null = $process.Handle
        if (-not $process.WaitForExit($script:InstallTimeoutSeconds * 1000)) { throw 'Uninstall did not finish in time.' }
    }
    Install-Release -SetupExe $setup[0].FullName
}

# --- Orchestration ---------------------------------------------------------------------

function New-DeployResult {
    param([string]$Status, [string]$Version, [string]$Previous, [string[]]$Problems = @(), [System.Collections.IDictionary]$Checks = @{})
    [pscustomobject]@{ Status = $Status; Version = $Version; Previous = $Previous; Problems = @($Problems); Checks = $Checks }
}

function Invoke-StationDeploy {
    <#
      Deploy $Version to this station. Returns a result object whose Checks say what was
      checked; throws only when the station may be left in an unexpected state.
    #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$ScannerName,
        [Parameter(Mandatory)][string]$ReleaseBaseUrl,
        [Parameter(Mandatory)][string]$TestSpecies,
        [Parameter(Mandatory)][string]$SchemaPath,
        [Parameter(Mandatory)][string]$ToolsDir,
        [switch]$RequireCamera,
        [string]$DeployRoot = 'C:\BloomDeploy',
        [string]$LocalAppData = $env:LOCALAPPDATA,
        [string]$ProfileDir = $env:USERPROFILE
    )
    $releasesRoot = Join-Path $DeployRoot 'releases'
    $backupRoot = Join-Path $DeployRoot 'backups'
    $logRoot = Join-Path $DeployRoot 'logs'
    foreach ($dir in $releasesRoot, $backupRoot, $logRoot) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-DeployLogFile -Path (Join-Path $logRoot ('{0}_v{1}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Version))
    $checks = [ordered]@{}

    $previous = Get-InstalledVersion -LocalAppData $LocalAppData
    Write-DeployLog "Deploying v$Version (installed: $(if ($previous) { "v$previous" } else { 'none' }))."

    # 1. Stage and verify. Nothing on the station has changed yet.
    $setup = Save-ReleaseFiles -BaseUrl $ReleaseBaseUrl -StageDir (Join-Path $releasesRoot "v$Version")
    Write-DeployLog 'Release files staged and verified.'

    # 2. The app must not be in use.
    if (Test-BloomRunning) {
        Write-DeployLog 'Bloom Desktop is running; nothing was changed. Close it and run the deploy again.'
        return New-DeployResult 'skipped-app-running' $Version $previous
    }

    # 3. Camera (reported; required only when asked) and Bloom access.
    $settings = Read-StationEnv -ProfileDir $ProfileDir
    $cameraOk = Test-CameraReachable -Address $settings['CAMERA_IP_ADDRESS']
    $checks['Camera'] = if ($cameraOk) { 'reachable' } elseif ($RequireCamera) { 'not reachable' } else { 'not reachable (not required)' }
    Write-DeployLog "Camera: $($checks['Camera'])."
    if (-not $cameraOk -and $RequireCamera) {
        return New-DeployResult 'camera-unreachable' $Version $previous @("Camera at $($settings['CAMERA_IP_ADDRESS']) did not answer; nothing was changed.") $checks
    }
    $bloomProblem = Test-BloomAccess -Settings $settings -ScannerName $ScannerName
    $checks['Bloom login'] = if ($bloomProblem) { 'failed' } else { 'ok' }
    if ($bloomProblem) {
        Write-DeployLog "Bloom: $bloomProblem Nothing was changed."
        return New-DeployResult 'bloom-check-failed' $Version $previous @($bloomProblem) $checks
    }

    # 4. Make sure the installed version can be reinstalled (e.g. after a manual install).
    if ($previous -and $previous -ne $Version -and -not (Test-Path (Join-Path $releasesRoot "v$previous\*.exe"))) {
        $previousUrl = $ReleaseBaseUrl -replace "/v$([regex]::Escape($Version))$", "/v$previous"
        try {
            Save-ReleaseFiles -BaseUrl $previousUrl -StageDir (Join-Path $releasesRoot "v$previous") | Out-Null
            Write-DeployLog "Staged v$previous for a rollback."
        }
        catch {
            $message = "Can't stage the installed v$previous for a rollback: $($_.Exception.Message) Nothing was changed."
            Write-DeployLog $message
            return New-DeployResult 'rollback-unavailable' $Version $previous @($message) $checks
        }
    }

    # 5. Back up before installing.
    $backup = Backup-StationData -ProfileDir $ProfileDir -BackupRoot $backupRoot -OldVersion $previous
    Write-DeployLog "Backup saved to $backup."

    # 6. Install, upgrade the database, check, self-test; any failure rolls back.
    $databasePath = Join-Path $ProfileDir '.bloom\data\bloom.db'
    $problems = @()
    try {
        $rowsBefore = Get-DatabaseRowCounts -DatabasePath $databasePath -ToolsDir $ToolsDir
        Install-Release -SetupExe $setup
        Update-StationDatabase -DatabasePath $databasePath -SchemaPath $SchemaPath -ToolsDir $ToolsDir
        $problems = @(Compare-RowCounts -Before $rowsBefore -After (Get-DatabaseRowCounts -DatabasePath $databasePath -ToolsDir $ToolsDir))
        $checks['Database'] = if ($problems.Count -eq 0) { 'upgraded, no rows lost' } else { 'rows lost' }
        $problems += @(Test-Installation -Version $Version -ScannerName $ScannerName -LocalAppData $LocalAppData -ProfileDir $ProfileDir)
        if ($problems.Count -eq 0) {
            $selfTest = Invoke-DeploySelfTest -Version $Version -LocalAppData $LocalAppData -ProfileDir $ProfileDir `
                -Species $TestSpecies -WorkDir (Join-Path $DeployRoot 'self-test')
            $checks['Upload self-test'] = "$($selfTest.Status): $($selfTest.Detail)"
            $problems += @($selfTest.Problems)
        }
    }
    catch {
        $problems += @("Deploy step failed: $($_.Exception.Message)")
    }

    if ($problems.Count -eq 0) {
        Remove-OldBackups -BackupRoot $backupRoot -Protect $backup
        Write-DeployLog "Deployed v$Version."
        return New-DeployResult 'deployed' $Version $previous @() $checks
    }

    foreach ($problem in $problems) { Write-DeployLog "Problem: $problem" }
    if (-not $previous) {
        Restore-StationData -BackupDir $backup -ProfileDir $ProfileDir
        Write-DeployLog 'Nothing to roll back to: this was the first deploy to this station.'
        return New-DeployResult 'failed-no-rollback' $Version $null $problems $checks
    }
    if ($previous -eq $Version) {
        Restore-StationData -BackupDir $backup -ProfileDir $ProfileDir
        Write-DeployLog "v$Version was already installed; left as is, data restored from the backup."
        return New-DeployResult 'failed-same-version' $Version $previous $problems $checks
    }
    Write-DeployLog "Rolling back to v$previous."
    Invoke-Rollback -PreviousVersion $previous -ReleasesRoot $releasesRoot -LocalAppData $LocalAppData
    Restore-StationData -BackupDir $backup -ProfileDir $ProfileDir
    Write-DeployLog "Rolled back to v$previous and restored the database and .env."
    New-DeployResult 'rolled-back' $Version $previous $problems $checks
}

Export-ModuleMember -Function Invoke-StationDeploy, Save-ReleaseFiles, Assert-Checksums, Get-InstalledVersion,
    Backup-StationData, Remove-OldBackups, Install-Release, Test-Installation, Invoke-Rollback
