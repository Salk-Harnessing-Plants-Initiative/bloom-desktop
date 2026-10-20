# Pester 5 tests for deploy/windows/BloomDeploy.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# Uses temp folders (TestDrive) and mocks for downloads, the installer, processes,
# user environment variables and disk space, so nothing touches a real station.

BeforeAll {
    $module = Join-Path $PSScriptRoot '..\..\deploy\windows\BloomDeploy.psm1'
    Import-Module $module -Force
}

Describe 'Assert-Checksums' {
    BeforeEach {
        $stage = Join-Path $TestDrive 'stage'
        New-Item -ItemType Directory -Force -Path $stage | Out-Null
        Set-Content -LiteralPath (Join-Path $stage 'Setup.exe') -Value 'installer' -NoNewline
        $hash = (Get-FileHash -LiteralPath (Join-Path $stage 'Setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS') -Value "$hash  Setup.exe"
    }

    It 'passes when the file matches' {
        { Assert-Checksums -StageDir $stage -FileNames 'Setup.exe' } | Should -Not -Throw
    }

    It 'throws on a mismatch' {
        Set-Content -LiteralPath (Join-Path $stage 'Setup.exe') -Value 'tampered' -NoNewline
        { Assert-Checksums -StageDir $stage -FileNames 'Setup.exe' } | Should -Throw '*Checksum mismatch*'
    }

    It 'throws when a file is not listed' {
        Set-Content -LiteralPath (Join-Path $stage 'other.nupkg') -Value 'x'
        { Assert-Checksums -StageDir $stage -FileNames 'other.nupkg' } | Should -Throw '*not listed*'
    }
}

Describe 'Get-InstalledVersion' {
    It 'returns $null when the app is not installed' {
        Get-InstalledVersion -LocalAppData (Join-Path $TestDrive 'empty') | Should -BeNullOrEmpty
    }

    It 'returns the newest version, mapping pre-release folders to release versions' {
        $root = Join-Path $TestDrive 'lad-rc\bloom_desktop'
        foreach ($v in '0.2.0', '0.2.1-rc1', '0.2.1-rc2') { New-Item -ItemType Directory -Force -Path (Join-Path $root "app-$v") | Out-Null }
        Get-InstalledVersion -LocalAppData (Join-Path $TestDrive 'lad-rc') | Should -Be '0.2.1-rc.2'
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'app-0.2.1') | Out-Null
        Get-InstalledVersion -LocalAppData (Join-Path $TestDrive 'lad-rc') | Should -Be '0.2.1'
    }

    It 'returns the highest app-<version> folder' {
        $root = Join-Path $TestDrive 'lad\bloom_desktop'
        foreach ($v in '0.1.9', '0.2.0', '0.10.0') { New-Item -ItemType Directory -Force -Path (Join-Path $root "app-$v") | Out-Null }
        Get-InstalledVersion -LocalAppData (Join-Path $TestDrive 'lad') | Should -Be '0.10.0'
    }
}

Describe 'Test-Installation' {
    BeforeEach {
        $lad = Join-Path $TestDrive 'lad'
        New-Item -ItemType Directory -Force -Path (Join-Path $lad 'bloom_desktop\app-0.2.0') | Out-Null
        $userProfile = Join-Path $TestDrive 'profile'
        New-Item -ItemType Directory -Force -Path (Join-Path $userProfile '.bloom') | Out-Null
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value @(
            'SCANNER_MODE=cylinderscan', 'SCANNER_NAME=PC1Scanner', 'CAMERA_IP_ADDRESS=10.0.0.5'
        )
        Mock -ModuleName BloomDeploy Get-UserEnvironmentVariable { 'false' }
        Mock -ModuleName BloomDeploy Get-FreeDiskGB { 100 }
    }

    It 'reports no problems for a ready station' {
        @(Test-Installation -Version '0.2.0' -ScannerName 'PC1Scanner' -LocalAppData $lad -ProfileDir $userProfile) |
            Should -HaveCount 0
    }

    It 'reports the wrong installed version' {
        @(Test-Installation -Version '0.3.0' -ScannerName 'PC1Scanner' -LocalAppData $lad -ProfileDir $userProfile) |
            Should -Contain "Installed version is '0.2.0', expected '0.3.0'."
    }

    It 'reports mock mode left on' {
        Mock -ModuleName BloomDeploy Get-UserEnvironmentVariable { 'true' } -ParameterFilter { $Name -eq 'BLOOM_USE_MOCK_CAMERA' }
        (@(Test-Installation -Version '0.2.0' -ScannerName 'PC1Scanner' -LocalAppData $lad -ProfileDir $userProfile) -join "`n") |
            Should -Match 'BLOOM_USE_MOCK_CAMERA'
    }

    It 'reports a mock camera, the wrong scanner and low disk space' {
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value @(
            'SCANNER_MODE=cylinderscan', 'SCANNER_NAME=Other', 'CAMERA_IP_ADDRESS=mock'
        )
        Mock -ModuleName BloomDeploy Get-FreeDiskGB { 3 }
        $text = @(Test-Installation -Version '0.2.0' -ScannerName 'PC1Scanner' -LocalAppData $lad -ProfileDir $userProfile) -join "`n"
        $text | Should -Match 'CAMERA_IP_ADDRESS'
        $text | Should -Match "SCANNER_NAME in .env is 'Other'"
        $text | Should -Match 'Only 3 GB free'
    }
}

Describe 'Install-Release' {
    It 'sets the skip-first-run variable for the installer and restores it afterwards' {
        $script:seen = $null
        Mock -ModuleName BloomDeploy Start-Process {
            $script:seen = [Environment]::GetEnvironmentVariable('BLOOM_DEPLOY_SKIP_FIRSTRUN', 'Process')
            [pscustomobject]@{ Handle = 1; ExitCode = 0 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
        Install-Release -SetupExe 'C:\fake\Setup.exe'
        $script:seen | Should -Be '1'
        [Environment]::GetEnvironmentVariable('BLOOM_DEPLOY_SKIP_FIRSTRUN', 'Process') | Should -BeNullOrEmpty
    }

    It 'throws when the installer fails' {
        Mock -ModuleName BloomDeploy Start-Process {
            [pscustomobject]@{ Handle = 1; ExitCode = 3 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
        { Install-Release -SetupExe 'C:\fake\Setup.exe' } | Should -Throw '*exited with code 3*'
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
        # The installed v0.1.0 is already staged, so no rollback download is needed.
        New-Item -ItemType Directory -Force -Path (Join-Path $root 'releases\v0.1.0') | Out-Null
        Set-Content -LiteralPath (Join-Path $root 'releases\v0.1.0\Setup.exe') -Value 'old'
        Mock -ModuleName BloomDeploy Save-ReleaseFiles { 'C:\stage\Setup.exe' }
        Mock -ModuleName BloomDeploy Test-BloomRunning { $false }
        Mock -ModuleName BloomDeploy Test-CameraReachable { $true }
        Mock -ModuleName BloomDeploy Test-BloomAccess { $null }
        Mock -ModuleName BloomDeploy Get-DatabaseRowCounts { @{ Scan = 5 } }
        Mock -ModuleName BloomDeploy Update-StationDatabase { }
        Mock -ModuleName BloomDeploy Install-Release { }
        Mock -ModuleName BloomDeploy Test-Installation { }
        Mock -ModuleName BloomDeploy Invoke-DeploySelfTest { [pscustomobject]@{ Status = 'passed'; Detail = 'plant P'; Problems = @() } }
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
        $result.Checks['Upload self-test'] | Should -Be 'passed: plant P'
        $result.Checks['Database'] | Should -Be 'upgraded, no rows lost'
    }

    It 'only reports a camera that is off, unless the camera is required' {
        Mock -ModuleName BloomDeploy Test-CameraReachable { $false }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'deployed'
        $result.Checks['Camera'] | Should -Be 'not reachable (not required)'

        $required = Invoke-StationDeploy @common -RequireCamera
        $required.Status | Should -Be 'camera-unreachable'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 1
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
        Mock -ModuleName BloomDeploy Test-Installation { 'SCANNER_MODE in .env must be cylinderscan.' }
        $result = Invoke-StationDeploy @common
        $result.Status | Should -Be 'rolled-back'
        $result.Problems | Should -Contain 'SCANNER_MODE in .env must be cylinderscan.'
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
        ($result.Problems -join "`n") | Should -Match ([regex]::Escape("$root\backups\"))
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

    It 'restores the data on a first deploy with nothing to reinstall' {
        Mock -ModuleName BloomDeploy Get-InstalledVersion { $null }
        Mock -ModuleName BloomDeploy Test-Installation { 'SCANNER_MODE in .env must be cylinderscan.' }
        (Invoke-StationDeploy @common).Status | Should -Be 'failed-no-rollback'
        Should -Invoke -ModuleName BloomDeploy Restore-StationData -Times 1 -Exactly
    }

    It 'changes nothing when Bloom Desktop is opened before the install' {
        $script:runningCalls = 0
        Mock -ModuleName BloomDeploy Test-BloomRunning { $script:runningCalls++; $script:runningCalls -gt 1 }
        (Invoke-StationDeploy @common).Status | Should -Be 'skipped-app-running'
        Should -Invoke -ModuleName BloomDeploy Install-Release -Times 0 -Exactly
    }

    It 'writes a log file' {
        Invoke-StationDeploy @common | Out-Null
        Get-ChildItem (Join-Path $root 'logs') -Filter '*_v0.2.0.log' | Should -HaveCount 1
    }
}
