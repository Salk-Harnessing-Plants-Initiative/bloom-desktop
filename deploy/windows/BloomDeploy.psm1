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
# previous version. The checks are in StationChecks.psm1, backups and restores in
# StationData.psm1, release files and installing in ReleaseInstall.psm1, the upload
# self-test in SelfTest.psm1. Each step is a named, timed section of the job log
# (DeployStages.psm1), and its result is a row of the job summary.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'DeployStages.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'StationData.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'ReleaseInstall.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'SelfTest.psm1') -Force

$script:ProcessName = 'Bloom Desktop'

function Test-BloomRunning {
    [bool](Get-Process -Name $script:ProcessName -ErrorAction SilentlyContinue)
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
      checked, each with the time it took. Throws only on an unexpected error, most often a
      download, checksum or backup failure before anything changed; the log says how far
      it got.
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
    # Every return (and an unexpected error) closes the section of the log still open.
    try {
        # 1. Stage and verify. Nothing on the station has changed yet.
        Start-DeployStage "Download and verify v$Version"
        $setup = Save-ReleaseFiles -BaseUrl $ReleaseBaseUrl -StageDir (Join-Path $releasesRoot "v$Version")
        $checks['Release files'] = Complete-DeployStage 'downloaded and verified'

        # 2. The app must not be in use.
        Start-DeployStage 'Check the station'
        if (Test-BloomRunning) {
            Write-DeployLog 'Bloom Desktop is running; nothing was changed. Close it and run the deploy again.'
            return New-DeployResult 'skipped-app-running' $Version $previous @() $checks
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
        Write-DeployLog "Bloom login: $($checks['Bloom login'])."
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
        Complete-DeployStage 'passed' | Out-Null

        # 4. Make sure the installed version can be reinstalled (e.g. after a manual install).
        Start-DeployStage 'Back up the station'
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
        $checks['Backup'] = Complete-DeployStage "saved to $backup"
        # Staging and the backup take minutes; make sure nobody opened the app meanwhile.
        if (Test-BloomRunning) {
            Write-DeployLog 'Bloom Desktop was opened during the deploy; nothing was changed. Run the deploy again when it is closed.'
            return New-DeployResult 'skipped-app-running' $Version $previous @('Bloom Desktop was opened during the deploy; nothing was changed. Close it and run the deploy again.') $checks
        }

        # 6. Install, upgrade the database, self-test; any failure rolls back.
        $problems = @()
        $selfTest = $null
        try {
            Start-DeployStage "Install v$Version"
            Install-Release -SetupExe $setup -LocalAppData $LocalAppData
            $problems += @(Test-Installation -Version $Version -LocalAppData $LocalAppData)
            $checks['Install'] = Complete-DeployStage $(if ($problems.Count -eq 0) { "v$Version installed" } else { 'wrong version installed' })

            if ($problems.Count -eq 0) {
                Start-DeployStage 'Upgrade the database'
                Update-StationDatabase -DatabasePath $databasePath -SchemaPath $SchemaPath -ToolsDir $ToolsDir
                $problems += @(Compare-RowCounts -Before $rowsBefore -After (Get-DatabaseRowCounts -DatabasePath $databasePath -ToolsDir $ToolsDir))
                $checks['Database'] = Complete-DeployStage $(if ($problems.Count -eq 0) { 'upgraded, no rows lost' } else { 'rows lost' })
            }
            if ($problems.Count -eq 0) {
                Start-DeployStage 'Upload self-test'
                $selfTest = Invoke-DeploySelfTest -Version $Version -LocalAppData $LocalAppData -ProfileDir $ProfileDir `
                    -Species $TestSpecies -WorkDir (Join-Path $DeployRoot 'self-test')
                $checks['Upload self-test'] = Complete-DeployStage "$($selfTest.Status): $($selfTest.Detail)"
                $problems += @($selfTest.Problems)
            }
        }
        catch {
            $problems += @("Deploy step failed: $($_.Exception.Message)")
            Complete-DeployStage 'failed' | Out-Null
        }

        if ($problems.Count -eq 0) {
            # Ask Bloom itself, so the run says where to find the test upload. Reported only: the
            # app already confirmed each upload, and a lookup problem mustn't undo a good deploy.
            if ($selfTest -and $selfTest.Status -eq 'passed' -and $selfTest.PlantId) {
                Start-DeployStage 'Check the upload in Bloom'
                $inBloom = Find-BloomUpload -Settings $settings -PlantId $selfTest.PlantId
                Write-DeployLog "Bloom: $($inBloom.Detail)."
                $checks['Found in Bloom'] = Complete-DeployStage $(if ($inBloom.Found) { "yes: $($inBloom.Detail)" } else { "no: $($inBloom.Detail)" })
                if (-not $inBloom.Found) {
                    Write-Host "::warning title=Test upload::$((Protect-DeployText -Text "Not found in Bloom: $($inBloom.Detail)").Replace('%', '%25'))"
                }
            }
            Remove-OldBackups -BackupRoot $backupRoot -Protect $backup
            Write-DeployLog "Deployed v$Version."
            return New-DeployResult 'deployed' $Version $previous @() $checks
        }

        foreach ($problem in $problems) { Write-DeployLog "Problem: $problem" }
        Start-DeployStage 'Restore the data and roll back'
        $recovery = Invoke-StationRecovery -Version $Version -Previous $previous -BackupDir $backup `
            -DeployRoot $DeployRoot -ReleasesRoot $releasesRoot -LocalAppData $LocalAppData -ProfileDir $ProfileDir
        $checks['Rollback'] = Complete-DeployStage $recovery.Status
        New-DeployResult $recovery.Status $Version $previous (@($problems) + @($recovery.Problems)) $checks
    }
    finally { Complete-DeployStage 'stopped' | Out-Null }
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

Export-ModuleMember -Function Invoke-StationDeploy
