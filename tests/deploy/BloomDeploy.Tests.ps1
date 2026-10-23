# Pester 5 tests for deploy/windows/BloomDeploy.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# Uses temp folders (TestDrive) and mocks for downloads, the installer, processes and
# the station checks, so nothing touches a real station.

BeforeAll {
    $module = Join-Path $PSScriptRoot '..\..\deploy\windows\BloomDeploy.psm1'
    Import-Module $module -Force
    # The instances BloomDeploy loaded: Protect-DeployText, and mocks inside StationData.
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\StationChecks.psm1')
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\StationData.psm1')

    # A staged release as Save-ReleaseFiles leaves it: manifest, SHA256SUMS and Setup.exe.
    function New-StagedRelease {
        param([Parameter(Mandatory)][string]$StageDir, [string]$Installer = 'installer')
        New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
        Set-Content -LiteralPath (Join-Path $StageDir 'Setup.exe') -Value $Installer -NoNewline
        $hash = (Get-FileHash -LiteralPath (Join-Path $StageDir 'Setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath (Join-Path $StageDir 'SHA256SUMS') -Value "$hash  Setup.exe"
        Set-Content -LiteralPath (Join-Path $StageDir 'manifest.json') -Value '{"files": [{"name": "Setup.exe", "target": "windows"}]}'
    }
}

Describe 'Invoke-StationDeploy' {
    BeforeEach {
        # A fresh folder per test: TestDrive is only cleared per Describe, so files from
        # one test (backups, logs) would otherwise show up in the next.
        $root = Join-Path $TestDrive ('deploy-' + [guid]::NewGuid())
        $lad = Join-Path $TestDrive 'lad'
        $userProfile = Join-Path $TestDrive 'profile'
        New-Item -ItemType Directory -Force -Path (Join-Path $userProfile '.bloom\data') | Out-Null
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db') -Value 'db'
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value 'CAMERA_IP_ADDRESS=10.0.0.45'
        $common = @{
            Version = '0.2.0'; ScannerName = 'PC1Scanner'; ReleaseBaseUrl = 'https://example.invalid/download/v0.2.0'
            TestSpecies = 'Sorghum'; SchemaPath = 'C:\release\prisma\schema.prisma'; ToolsDir = 'C:\tools'
            DeployRoot = $root; LocalAppData = $lad; ProfileDir = $userProfile
        }
        # The installed v0.1.0 is already staged and verifies, so no rollback download is needed.
        New-StagedRelease -StageDir (Join-Path $root 'releases\v0.1.0') -Installer 'old'
        Mock -ModuleName BloomDeploy Save-ReleaseFiles { 'C:\stage\Setup.exe' }
        Mock -ModuleName BloomDeploy Test-BloomRunning { $false }
        Mock -ModuleName BloomDeploy Test-CameraReachable { $true }
        Mock -ModuleName BloomDeploy Test-BloomAccess { $null }
        Mock -ModuleName BloomDeploy Test-StationReady { }
        Mock -ModuleName BloomDeploy Get-ScansDriveHealth { '250 GB of free disk space' }
        Mock -ModuleName BloomDeploy Get-DatabaseRowCounts { @{ Scan = 5 } }
        Mock -ModuleName BloomDeploy Update-StationDatabase { }
        Mock -ModuleName BloomDeploy Install-Release { }
        Mock -ModuleName BloomDeploy Test-Installation { }
        Mock -ModuleName BloomDeploy Invoke-DeploySelfTest { [pscustomobject]@{ Status = 'passed'; Detail = 'plant P'; PlantId = 'P'; Problems = @() } }
        Mock -ModuleName BloomDeploy Find-BloomUpload { [pscustomobject]@{ Found = $true; Detail = 'plant P (id 9) in experiment ''DEPLOY-TEST PC1Scanner'' (id 3) with 1 scan(s) and 3 image(s)' } }
        Mock -ModuleName BloomDeploy Invoke-Rollback { }
        Mock -ModuleName BloomDeploy Restore-StationData { }
        Mock -ModuleName BloomDeploy Save-FailedDatabase { }
        Mock -ModuleName BloomDeploy Get-InstalledVersion { '0.1.0' }
    }

    It 'deploys, upgrades the database, self-tests and keeps the backup' {
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'deployed'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 1
        Should -Invoke -ModuleName BloomDeploy Update-StationDatabase -Times 1 -ParameterFilter { $SchemaPath -eq 'C:\release\prisma\schema.prisma' }
        Should -Invoke -ModuleName BloomDeploy Invoke-DeploySelfTest -Times 1 -ParameterFilter { $Species -eq 'Sorghum' }
        (Get-ChildItem (Join-Path $root 'backups') -Directory) | Should -HaveCount 1
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0
        # Each stage's row ends with the time it took.
        $result.Checks['Upload self-test'] | Should -Match '^passed: plant P \(\d+s\)$'
        $result.Checks['Database'] | Should -Match '^upgraded, no rows lost \(\d+s\)$'
        $result.Checks['Install'] | Should -Match '^v0\.2\.0 installed \(\d+s\)$'
        $result.Checks['Backup'] | Should -Match ('^saved to ' + [regex]::Escape((Join-Path $root 'backups')))
        $result.Checks['Found in Bloom'] | Should -BeLike "yes: plant P (id 9) in experiment 'DEPLOY-TEST PC1Scanner'*"
        Should -Invoke -ModuleName BloomDeploy Find-BloomUpload -Times 1 -Exactly -ParameterFilter { $PlantId -eq 'P' }
        $result.Checks['Station settings'] | Should -Be 'ok'
        $result.Checks['Scans drive (health only)'] | Should -Be '250 GB of free disk space'
        # Only the new release: the staged v0.1.0 verifies, so it isn't downloaded again.
        Should -Invoke -ModuleName BloomDeploy Save-ReleaseFiles -Times 1 -Exactly
    }

    It 'downloads the installed version again when its staged files were changed' {
        Set-Content -LiteralPath (Join-Path $root 'releases\v0.1.0\Setup.exe') -Value 'swapped' -NoNewline
        (Invoke-StationDeploy @common).Status | Should -Be 'deployed'
        Should -Invoke -ModuleName BloomDeploy Save-ReleaseFiles -Times 1 -Exactly -ParameterFilter { $BaseUrl -like '*/v0.1.0' }
    }

    It 'changes nothing when the installed version''s download address cannot be worked out' {
        Remove-Item -LiteralPath (Join-Path $root 'releases\v0.1.0') -Recurse -Force
        $elsewhere = $common.Clone()
        $elsewhere['ReleaseBaseUrl'] = 'https://example.invalid/somewhere-else'
        $result = Invoke-StationDeploy @elsewhere
        $result.Status | Should -Be 'rollback-unavailable'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0 -Exactly
    }

    It 'still reports deployed when an old backup cannot be removed' {
        foreach ($day in 1..6) { New-Item -ItemType Directory -Force -Path (Join-Path $root ('backups\2026010{0}-000000_v0.0.9' -f $day)) | Out-Null }
        Mock -ModuleName StationData Remove-Item { throw 'The process cannot access the file.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'deployed'
        Should -Invoke -ModuleName StationData Remove-Item -Times 2 -Exactly
    }

    It 'only reports a camera that is off, unless the camera is required' {
        Mock -ModuleName BloomDeploy Test-CameraReachable { $false }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'deployed'
        $result.Checks['Camera'] | Should -Be 'not reachable (not required)'

        $required = Invoke-StationDeploy @common -RequireCamera
        $required.Status | Should -Be 'camera-unreachable'
        # The one install is the first run's; the required-camera run changed nothing.
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 1 -Exactly
        (Get-ChildItem (Join-Path $root 'backups') -Directory) | Should -HaveCount 1
    }

    It 'changes nothing when Bloom refuses the login' {
        Mock -ModuleName BloomDeploy Test-BloomAccess { 'Bloom login failed for x: Invalid login credentials' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'bloom-check-failed'
        $result.Problems | Should -Contain 'Bloom login failed for x: Invalid login credentials'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0
        Test-Path (Join-Path $root 'backups\*') | Should -BeFalse
    }

    It 'stages the installed version for a rollback when it is not staged yet' {
        Remove-Item -LiteralPath (Join-Path $root 'releases\v0.1.0') -Recurse -Force
        (Invoke-StationDeploy @common).Status | Should -Be 'deployed'
        Should -Invoke -ModuleName BloomDeploy Save-ReleaseFiles -Times 1 -ParameterFilter {
            $BaseUrl -eq 'https://example.invalid/download/v0.1.0' -and $StageDir -like '*releases\v0.1.0'
        }
    }

    It 'changes nothing when the station settings are not ready' {
        Mock -ModuleName BloomDeploy Test-StationReady { 'SCANNER_MODE in .env must be cylinderscan.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'station-not-ready'
        $result.Problems | Should -Contain 'SCANNER_MODE in .env must be cylinderscan.'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0 -Exactly
        Test-Path (Join-Path $root 'backups\*') | Should -BeFalse
        # The health line is there when the operator most needs it.
        $result.Checks['Scans drive (health only)'] | Should -Be '250 GB of free disk space'
    }

    It 'shows a low scans drive as a warning on the run, without stopping the deploy' {
        Mock -ModuleName BloomDeploy Get-ScansDriveHealth { 'only 3 GB of free disk space; scans may fail (at least 20 GB recommended)' }
        $output = Invoke-StationDeploy @common 6>&1 | ForEach-Object { "$_" }
        ($output | Where-Object { $_ -like 'Deployed*' -or $_ -like '::warning*' }) -join "`n" |
            Should -Match '::warning title=Scans drive::only 3 GB of free disk space'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 1 -Exactly
    }

    It 'changes nothing when the database cannot be read' {
        Mock -ModuleName BloomDeploy Get-DatabaseRowCounts { throw 'database is locked' }
        (Invoke-StationDeploy @common).Status | Should -Be 'database-unreadable'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0 -Exactly
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0 -Exactly
        Test-Path (Join-Path $root 'backups\*') | Should -BeFalse
    }

    It 'changes nothing when the installed version cannot be staged' {
        Remove-Item -LiteralPath (Join-Path $root 'releases\v0.1.0') -Recurse -Force
        Mock -ModuleName BloomDeploy Save-ReleaseFiles { throw 'not found' } -ParameterFilter { $BaseUrl -like '*v0.1.0' }
        (Invoke-StationDeploy @common).Status | Should -Be 'rollback-unavailable'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0
    }

    It 'rolls back and restores the data when the database upgrade fails' {
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed (prisma migrate deploy exited 1).' }
        (Invoke-StationDeploy @common).Status | Should -Be 'rolled-back'
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 1
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1
    }

    It 'rolls back when the upgrade loses rows' {
        $script:countCall = 0
        Mock -ModuleName BloomDeploy Get-DatabaseRowCounts {
            $script:countCall++
            if ($script:countCall -eq 1) { @{ Scan = 5 } } else { @{ Scan = 4 } }
        }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rolled-back'
        $result.Problems | Should -Contain 'Table Scan had 5 rows before the upgrade and 4 after.'
        Should -Invoke -ModuleName BloomDeploy Invoke-DeploySelfTest -Times 0
    }

    It 'rolls back and restores the data when the upload self-test fails' {
        Mock -ModuleName BloomDeploy Invoke-DeploySelfTest {
            [pscustomobject]@{ Status = 'failed'; Detail = 'plant P'; Problems = @('Self-test upload failed: timeout') }
        }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rolled-back'
        $result.Problems | Should -Contain 'Self-test upload failed: timeout'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1
    }

    It 'stops before any change if the release files do not verify' {
        Mock -ModuleName BloomDeploy Save-ReleaseFiles { throw 'Checksum mismatch for Setup.exe' }
        { Invoke-StationDeploy @common } | Should -Throw '*Checksum mismatch*'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0
        Test-Path (Join-Path $root 'backups\*') | Should -BeFalse
    }

    It 'changes nothing while the app is running' {
        Mock -ModuleName BloomDeploy Test-BloomRunning { $true }
        (Invoke-StationDeploy @common).Status | Should -Be 'skipped-app-running'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0
        Test-Path (Join-Path $root 'backups\*') | Should -BeFalse
    }

    It 'does not install if the backup fails' {
        Mock -ModuleName BloomDeploy Backup-StationData { throw 'Backup copy does not match' }
        { Invoke-StationDeploy @common } | Should -Throw '*Backup copy*'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0
    }

    It 'rolls back to the previous version when verification fails' {
        Mock -ModuleName BloomDeploy Test-Installation { "Installed version is '0.1.0', expected '0.2.0'." }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rolled-back'
        $result.Problems | Should -Contain "Installed version is '0.1.0', expected '0.2.0'."
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 1 -ParameterFilter { $PreviousVersion -eq '0.1.0' }
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1
    }

    It 'rolls back when the installer itself fails' {
        Mock -ModuleName BloomDeploy Install-Release { throw 'Setup.exe exited with code 1.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'rolled-back'
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 1
    }

    It 'says so when there is nothing to roll back to' {
        Mock -ModuleName BloomDeploy Get-InstalledVersion { $null }
        Mock -ModuleName BloomDeploy Test-Installation { 'Installed version is '''', expected ''0.2.0''.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'failed-no-rollback'
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0
    }

    It 'keeps the failed database, restores the data, then reinstalls, in that order' {
        $script:calls = [System.Collections.Generic.List[string]]::new()
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        Mock -ModuleName BloomDeploy Save-FailedDatabase { $script:calls.Add('keep-failed') }
        Mock -ModuleName BloomDeploy Restore-StationData { $script:calls.Add('restore') }
        Mock -ModuleName BloomDeploy Invoke-Rollback { $script:calls.Add('reinstall') }
        (Invoke-StationDeploy @common).Status | Should -Be 'rolled-back'
        $script:calls | Should -Be @('keep-failed', 'restore', 'reinstall')
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly -ParameterFilter { $BackupDir -like "$root\backups\*_v0.1.0" }
    }

    It 'reports rollback-failed, with the backup, when reinstalling fails after the data is restored' {
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        Mock -ModuleName BloomDeploy Invoke-Rollback { throw 'Setup.exe exited with code 1.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rollback-failed'
        ($result.Problems -join "`n") | Should -Match 'data was restored, but reinstalling v0.1.0 failed'
        ($result.Problems -join "`n") | Should -Match ([regex]::Escape((Protect-DeployText -Text "$root\backups\")))
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly
    }

    It 'reports rollback-failed when the previous version is not what is installed afterwards' {
        $script:versionCalls = 0
        Mock -ModuleName BloomDeploy Get-InstalledVersion { $script:versionCalls++; if ($script:versionCalls -eq 1) { '0.1.0' } else { '0.2.0' } }
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rollback-failed'
        ($result.Problems -join "`n") | Should -Match "installed version is '0.2.0', not v0.1.0"
    }

    It 'does not reinstall when restoring the data fails' {
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        Mock -ModuleName BloomDeploy Restore-StationData { throw 'The copy does not match the original.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rollback-failed'
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0 -Exactly
    }

    It 'leaves the data alone when Bloom Desktop was opened during the deploy' {
        $script:runningCalls = 0
        # Running only at the third check: after the start and just-before-install checks.
        Mock -ModuleName BloomDeploy Test-BloomRunning { $script:runningCalls++; $script:runningCalls -gt 2 }
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'needs-attention'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 0 -Exactly
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0 -Exactly
    }

    It 'restores the data even when the failed database cannot be kept' {
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        Mock -ModuleName BloomDeploy Save-FailedDatabase { throw 'There is not enough space on the disk.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'rolled-back'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 1 -Exactly
    }

    It 'restores the data but does not reinstall when redeploying the installed version fails' {
        Mock -ModuleName BloomDeploy Get-InstalledVersion { '0.2.0' }
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw 'Database upgrade failed.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'failed-same-version'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0 -Exactly
        Should -Invoke -ModuleName BloomDeploy Save-ReleaseFiles -Times 1 -Exactly
    }

    It 'keeps station details out of the problems in the job summary' {
        Mock -ModuleName BloomDeploy Update-StationDatabase { throw "Can't open $userProfile\.bloom\data\bloom.db (camera 10.0.0.45)" }
        $result = Invoke-StationDeploy @common
        $text = $result.Problems -join "`n"
        $text | Should -Not -Match ([regex]::Escape($userProfile))
        $text | Should -Not -Match '10\.0\.0\.45'
        Get-Content -Raw (Get-ChildItem (Join-Path $root 'logs') -Filter '*.log').FullName | Should -Not -Match '10\.0\.0\.45'
    }

    It 'restores the data on a first deploy with nothing to reinstall' {
        Mock -ModuleName BloomDeploy Get-InstalledVersion { $null }
        Mock -ModuleName BloomDeploy Test-Installation { "Installed version is '', expected '0.2.0'." }
        (Invoke-StationDeploy @common).Status | Should -Be 'failed-no-rollback'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly
    }

    It 'changes nothing when Bloom Desktop is opened before the install' {
        $script:runningCalls = 0
        Mock -ModuleName BloomDeploy Test-BloomRunning { $script:runningCalls++; $script:runningCalls -gt 1 }
        (Invoke-StationDeploy @common).Status | Should -Be 'skipped-app-running'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0 -Exactly
    }

    It 'still deploys, with a warning, when Bloom does not show the test upload' {
        Mock -ModuleName BloomDeploy Find-BloomUpload { [pscustomobject]@{ Found = $false; Detail = 'plant P not found in Bloom' } }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'deployed'
        $result.Checks['Found in Bloom'] | Should -BeLike 'no: plant P not found in Bloom*'
        Should -Invoke -ModuleName BloomDeploy Invoke-Rollback -Times 0 -Exactly
    }

    It 'does not look in Bloom when the self-test failed' {
        Mock -ModuleName BloomDeploy Invoke-DeploySelfTest { [pscustomobject]@{ Status = 'failed'; Detail = 'plant P'; PlantId = 'P'; Problems = @('Self-test upload failed: denied') } }
        (Invoke-StationDeploy @common).Status | Should -Be 'rolled-back'
        Should -Invoke -ModuleName BloomDeploy Find-BloomUpload -Times 0 -Exactly
    }

    It 'skips the database upgrade when the wrong version was installed' {
        Mock -ModuleName BloomDeploy Test-Installation { "Installed version is '0.1.0', expected '0.2.0'." }
        $result = Invoke-StationDeploy @common
        $result.Checks['Install'] | Should -BeLike 'wrong version installed*'
        Should -Invoke -ModuleName BloomDeploy Update-StationDatabase -Times 0 -Exactly
    }

    It 'shows each stage as a section of the job log, closed even when the deploy stops early' {
        Mock -ModuleName DeployStages Write-Host { }
        Mock -ModuleName BloomDeploy Test-StationReady { 'SCANNER_MODE in .env must be cylinderscan.' }
        Invoke-StationDeploy @common | Out-Null
        Should -Invoke -ModuleName DeployStages Write-Host -ParameterFilter { $Object -eq '::group::Check the station' }
        Should -Invoke -ModuleName DeployStages Write-Host -Times 2 -Exactly -ParameterFilter { $Object -eq '::endgroup::' }
    }

    It 'writes a log file' {
        Invoke-StationDeploy @common | Out-Null
        Get-ChildItem (Join-Path $root 'logs') -Filter '*_v0.2.0.log' | Should -HaveCount 1
    }
}
