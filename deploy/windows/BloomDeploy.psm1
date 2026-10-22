# BloomDeploy.psm1: install a Bloom Desktop release on a Windows CylinderScan station.
#
# Called by deploy-station.ps1 from the Deploy workflow, on the station's self-hosted
# runner, under the station's lab account (Squirrel installs per user). Every step is a
# small function so it can be tested with Pester on windows-latest using fakes.
#
# Order matters: nothing on the station changes until the release files verify, the app
# is confirmed not running, Bloom accepts the station's login, the station's settings are
# ready, the installed version's files are staged for a rollback, the database can be
# read, and the backup is verified. A failed install, database upgrade, check or upload
# self-test restores the database and .env from the backup first, then reinstalls the
# previous version. The checks are in StationChecks.psm1; backups and restores are in
# StationData.psm1.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'StationData.psm1') -Force

# --- Constants -------------------------------------------------------------------------

$script:InstallTimeoutSeconds = 600
$script:DownloadTimeoutSeconds = 600
$script:ProcessName = 'Bloom Desktop'
$script:SquirrelAppFolder = 'bloom_desktop'
# The app quits on Squirrel's --squirrel-firstrun when this is set, so an install from
# the runner service doesn't start the app (and open the database) in a hidden session.
$script:SkipFirstRunVariable = 'BLOOM_DEPLOY_SKIP_FIRSTRUN'

# --- Small helpers ---------------------------------------------------------------------

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

function Test-StagedRelease {
    <# True when $StageDir holds a release's manifest, SHA256SUMS and Windows files, all matching. #>
    param([Parameter(Mandatory)][string]$StageDir)
    $manifestPath = Join-Path $StageDir 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath (Join-Path $StageDir 'SHA256SUMS'))) { return $false }
    $names = @((Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).files |
        Where-Object { $_.target -eq 'windows' } | ForEach-Object { $_.name })
    if ($names.Count -eq 0) { return $false }
    try { Assert-Checksums -StageDir $StageDir -FileNames $names; $true } catch { $false }
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
    <#
      Newest app-<version> folder under %LOCALAPPDATA%\bloom_desktop, in release form
      (app-0.2.1-rc1 is 0.2.1-rc.1), or $null.
    #>
    param([Parameter(Mandatory)][string]$LocalAppData)
    $root = Join-Path $LocalAppData $script:SquirrelAppFolder
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $versions = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' |
        ForEach-Object { $_.Name.Substring(4) } |
        Where-Object { $_ -match '^\d+\.\d+\.\d+(-[A-Za-z]+\d+)?$' } |
        ForEach-Object { ConvertFrom-SquirrelVersion -Version $_ })
    if ($versions.Count -eq 0) { return $null }
    @(Sort-ReleaseVersions -Versions $versions)[-1]
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
    <# After installing: a list of problems; empty when $Version is the installed version. #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$LocalAppData
    )
    $installed = Get-InstalledVersion -LocalAppData $LocalAppData
    if ($installed -ne $Version) { return @("Installed version is '$installed', expected '$Version'.") }
    @()
}

function Invoke-Rollback {
    <# Reinstall $PreviousVersion from its staged release. Squirrel won't downgrade in place. #>
    param(
        [Parameter(Mandatory)][string]$PreviousVersion,
        [Parameter(Mandatory)][string]$ReleasesRoot,
        [Parameter(Mandatory)][string]$LocalAppData
    )
    $stage = Join-Path $ReleasesRoot "v$PreviousVersion"
    if (-not (Test-StagedRelease -StageDir $stage)) {
        throw "Can't roll back: the staged files for v$PreviousVersion in $stage are missing or don't match SHA256SUMS."
    }
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
    # Problems go to the public job summary.
    $safe = @($Problems | ForEach-Object { Protect-DeployText -Text $_ })
    [pscustomobject]@{ Status = $Status; Version = $Version; Previous = $Previous; Problems = $safe; Checks = $Checks }
}

function Invoke-StationDeploy {
    <#
      Deploy $Version to this station. Returns a result object whose Checks say what was
      checked. Throws only on an unexpected error, most often a download, checksum or
      backup failure before anything changed; the log says how far it got.
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
    Set-DeployRedactions -Settings $settings
    $cameraOk = Test-CameraReachable -Address $settings['CAMERA_IP_ADDRESS']
    $checks['Camera'] = if ($cameraOk) { 'reachable' } elseif ($RequireCamera) { 'not reachable' } else { 'not reachable (not required)' }
    Write-DeployLog "Camera: $($checks['Camera'])."
    if (-not $cameraOk -and $RequireCamera) {
        return New-DeployResult 'camera-unreachable' $Version $previous @('The camera (CAMERA_IP_ADDRESS in .env) did not answer; nothing was changed.') $checks
    }
    $bloomProblem = Test-BloomAccess -Settings $settings -ScannerName $ScannerName
    $checks['Bloom login'] = if ($bloomProblem) { 'failed' } else { 'ok' }
    if ($bloomProblem) {
        Write-DeployLog "Bloom: $bloomProblem Nothing was changed."
        return New-DeployResult 'bloom-check-failed' $Version $previous @($bloomProblem) $checks
    }

    $notReady = @(Test-StationReady -ScannerName $ScannerName -ProfileDir $ProfileDir -DeployRoot $DeployRoot)
    $checks['Station settings'] = if ($notReady.Count -eq 0) { 'ok' } else { 'not ready' }
    $checks['Scans drive (health only)'] = Get-ScansDriveHealth -ProfileDir $ProfileDir
    Write-DeployLog "Scans drive: $($checks['Scans drive (health only)'])."
    # A low or unreadable scans drive is easy to miss in a successful run: show it on the run page.
    if ($checks['Scans drive (health only)'] -match '^(only|could not read)') {
        Write-Host "::warning title=Scans drive::$((Protect-DeployText -Text $checks['Scans drive (health only)']).Replace('%', '%25'))"
    }
    if ($notReady.Count -gt 0) {
        foreach ($problem in $notReady) { Write-DeployLog "Not ready: $problem" }
        return New-DeployResult 'station-not-ready' $Version $previous $notReady $checks
    }

    # 4. Make sure the installed version can be reinstalled (e.g. after a manual install).
    if ($previous -and $previous -ne $Version -and -not (Test-StagedRelease -StageDir (Join-Path $releasesRoot "v$previous"))) {
        $previousUrl = $ReleaseBaseUrl -replace "/v$([regex]::Escape($Version))$", "/v$previous"
        if ($previousUrl -eq $ReleaseBaseUrl) {
            return New-DeployResult 'rollback-unavailable' $Version $previous @("Can't work out the download address of v$previous; nothing was changed.") $checks
        }
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

    # The database must be readable before it's backed up and upgraded.
    $databasePath = Join-Path $ProfileDir '.bloom\data\bloom.db'
    try {
        $rowsBefore = Get-DatabaseRowCounts -DatabasePath $databasePath -ToolsDir $ToolsDir
    }
    catch {
        $message = "Can't read the station's database before the upgrade: $($_.Exception.Message) Nothing was changed."
        Write-DeployLog $message
        return New-DeployResult 'database-unreadable' $Version $previous @($message) $checks
    }

    # 5. Back up before installing.
    $backup = Backup-StationData -ProfileDir $ProfileDir -BackupRoot $backupRoot -OldVersion $previous
    Write-DeployLog "Backup saved to $backup."
    # Staging and the backup take minutes; make sure nobody opened the app meanwhile.
    if (Test-BloomRunning) {
        Write-DeployLog 'Bloom Desktop was opened during the deploy; nothing was changed. Run the deploy again when it is closed.'
        return New-DeployResult 'skipped-app-running' $Version $previous @('Bloom Desktop was opened during the deploy; nothing was changed. Close it and run the deploy again.') $checks
    }

    # 6. Install, upgrade the database, check, self-test; any failure rolls back.
    $problems = @()
    try {
        Install-Release -SetupExe $setup
        Update-StationDatabase -DatabasePath $databasePath -SchemaPath $SchemaPath -ToolsDir $ToolsDir
        $problems = @(Compare-RowCounts -Before $rowsBefore -After (Get-DatabaseRowCounts -DatabasePath $databasePath -ToolsDir $ToolsDir))
        $checks['Database'] = if ($problems.Count -eq 0) { 'upgraded, no rows lost' } else { 'rows lost' }
        $problems += @(Test-Installation -Version $Version -LocalAppData $LocalAppData)
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
    $recovery = Invoke-StationRecovery -Version $Version -Previous $previous -BackupDir $backup `
        -DeployRoot $DeployRoot -ReleasesRoot $releasesRoot -LocalAppData $LocalAppData -ProfileDir $ProfileDir
    New-DeployResult $recovery.Status $Version $previous (@($problems) + @($recovery.Problems)) $checks
}

function New-RecoveryResult {
    param([string]$Status, [string[]]$Problems = @())
    [pscustomobject]@{ Status = $Status; Problems = @($Problems) }
}

function Invoke-StationRecovery {
    <#
      After a failed deploy: keep the database it left behind, restore bloom.db and .env
      from this deploy's backup (first, since the data matters most and needs no app),
      then reinstall the previous version. Each step is checked. Returns Status
      (rolled-back, failed-same-version, failed-no-rollback, rollback-failed or
      needs-attention) and Problems.
    #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [string]$Previous,
        [Parameter(Mandatory)][string]$BackupDir,
        [Parameter(Mandatory)][string]$DeployRoot,
        [Parameter(Mandatory)][string]$ReleasesRoot,
        [Parameter(Mandatory)][string]$LocalAppData,
        [Parameter(Mandatory)][string]$ProfileDir
    )
    $byHand = "The station's data from before the deploy is in $BackupDir; see 'Restoring a backup by hand' in docs/STATION_SETUP.md."
    if (Test-BloomRunning) {
        Write-DeployLog 'Bloom Desktop was opened during the deploy; its data was left as is.'
        return New-RecoveryResult 'needs-attention' @(
            "Bloom Desktop was opened during the deploy, so nothing was put back: v$Version is installed and the database may be partly upgraded. Stop scanning on this station until it is restored by hand: scans saved now would be lost when the backup is restored.",
            $byHand)
    }
    # The failed copy is only for working out what went wrong: it must never stop the restore.
    try { Save-FailedDatabase -ProfileDir $ProfileDir -FailedRoot (Join-Path $DeployRoot 'failed') -Version $Version | Out-Null }
    catch { Write-DeployLog "Could not keep a copy of the failed database: $($_.Exception.Message)" }
    try {
        Restore-StationData -BackupDir $BackupDir -ProfileDir $ProfileDir
    }
    catch {
        Write-DeployLog "Restoring the data failed: $($_.Exception.Message)"
        return New-RecoveryResult 'rollback-failed' @("Restoring the data failed: $($_.Exception.Message)", $byHand)
    }

    if (-not $Previous) {
        Write-DeployLog 'Data restored. Nothing to reinstall: this was the first deploy to this station.'
        return New-RecoveryResult 'failed-no-rollback'
    }
    if ($Previous -eq $Version) {
        Write-DeployLog "Data restored. v$Version was already installed."
        return New-RecoveryResult 'failed-same-version'
    }
    try {
        Write-DeployLog "Data restored. Reinstalling v$Previous."
        Invoke-Rollback -PreviousVersion $Previous -ReleasesRoot $ReleasesRoot -LocalAppData $LocalAppData
    }
    catch {
        Write-DeployLog "Reinstalling v$Previous failed: $($_.Exception.Message)"
        return New-RecoveryResult 'rollback-failed' @("The data was restored, but reinstalling v$Previous failed: $($_.Exception.Message)", $byHand)
    }
    $installed = Get-InstalledVersion -LocalAppData $LocalAppData
    if ($installed -ne $Previous) {
        return New-RecoveryResult 'rollback-failed' @("The data was restored, but the installed version is '$installed', not v$Previous.", $byHand)
    }
    Write-DeployLog "Rolled back to v$Previous with the data restored."
    New-RecoveryResult 'rolled-back'
}

Export-ModuleMember -Function Invoke-StationDeploy, Save-ReleaseFiles, Test-StagedRelease, Assert-Checksums, Get-InstalledVersion,
    Install-Release, Test-Installation, Invoke-Rollback
