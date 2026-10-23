# Pester 5 tests for deploy/windows/StationChecks.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# Network calls, ping and the app process are mocked; files live in TestDrive.

BeforeAll {
    $module = Join-Path $PSScriptRoot '..\..\deploy\windows\StationChecks.psm1'
    Import-Module $module -Force

    function New-StationProfile {
        param([string[]]$EnvLines)
        $userProfile = Join-Path $TestDrive ('profile-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path (Join-Path $userProfile '.bloom\data') | Out-Null
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db') -Value 'db'
        if ($EnvLines) { Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value $EnvLines }
        $userProfile
    }
}

Describe 'Release and Squirrel versions' {
    It 'maps a pre-release to the installer folder name and back' {
        ConvertTo-SquirrelVersion -Version '0.2.1-rc.1' | Should -Be '0.2.1-rc1'
        ConvertFrom-SquirrelVersion -Version '0.2.1-rc1' | Should -Be '0.2.1-rc.1'
        ConvertTo-SquirrelVersion -Version '0.2.1' | Should -Be '0.2.1'
        ConvertFrom-SquirrelVersion -Version '0.2.1' | Should -Be '0.2.1'
    }

    It 'sorts pre-releases before their release' {
        Sort-ReleaseVersions -Versions @('0.2.1', '0.2.1-rc.2', '0.10.0', '0.2.1-rc.1', '0.2.0') |
            Should -Be @('0.2.0', '0.2.1-rc.1', '0.2.1-rc.2', '0.2.1', '0.10.0')
    }
}

Describe 'Write-DeployLog' {
    It 'never fails because the log file cannot be written' {
        Set-DeployLogFile -Path (Join-Path $TestDrive 'missing-folder\deploy.log')
        # -ErrorAction Stop, so this fails on a revert whatever the shell's error preference.
        try { { Write-DeployLog -Message 'hello' -ErrorAction Stop } | Should -Not -Throw }
        finally { Set-DeployLogFile -Path '' }
    }
}

Describe 'Read-StationEnv' {
    It 'reads KEY=value lines and strips quotes' {
        $userProfile = New-StationProfile -EnvLines @('SCANNER_NAME="FastScanner"', 'CAMERA_IP_ADDRESS = 10.0.0.45', '# comment')
        $settings = Read-StationEnv -ProfileDir $userProfile
        $settings['SCANNER_NAME'] | Should -Be 'FastScanner'
        $settings['CAMERA_IP_ADDRESS'] | Should -Be '10.0.0.45'
    }

    It 'is empty when there is no .env' {
        (Read-StationEnv -ProfileDir (New-StationProfile)).Count | Should -Be 0
    }
}

Describe 'Test-StationReady' {
    BeforeEach {
        $scans = Join-Path $TestDrive ('scans-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path $scans | Out-Null
        $userProfile = New-StationProfile -EnvLines @(
            'SCANNER_MODE=cylinderscan', 'SCANNER_NAME=PC1Scanner', 'CAMERA_IP_ADDRESS=10.0.0.5', "SCANS_DIR=$scans"
        )
        $ready = @{ ScannerName = 'PC1Scanner'; ProfileDir = $userProfile; DeployRoot = $TestDrive }
        Mock -ModuleName StationChecks Get-UserEnvironmentVariable { 'false' }
        Mock -ModuleName StationChecks Get-FreeDiskGB { 100 }
    }

    It 'reports no problems for a ready station' {
        @(Test-StationReady @ready) | Should -HaveCount 0
    }

    It 'reports mock mode left on' {
        Mock -ModuleName StationChecks Get-UserEnvironmentVariable { 'true' } -ParameterFilter { $Name -eq 'BLOOM_USE_MOCK_CAMERA' }
        (@(Test-StationReady @ready) -join "`n") | Should -Match 'BLOOM_USE_MOCK_CAMERA'
    }

    It 'reports a mock camera, the wrong scanner and a missing scans folder' {
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value @(
            'SCANNER_MODE=cylinderscan', 'SCANNER_NAME=Other', 'CAMERA_IP_ADDRESS=mock', 'SCANS_DIR=Z:\missing'
        )
        $text = @(Test-StationReady @ready) -join "`n"
        $text | Should -Match 'CAMERA_IP_ADDRESS'
        $text | Should -Match "SCANNER_NAME in .env is 'Other'"
        $text | Should -Match 'SCANS_DIR'
    }

    It 'stops for low free disk space on the deploy drive, not on the scans drive' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { 3 } -ParameterFilter { $Path -eq $scans }
        Mock -ModuleName StationChecks Get-FreeDiskGB { 1 } -ParameterFilter { $Path -eq $TestDrive }
        $problems = @(Test-StationReady @ready)
        $problems | Should -HaveCount 1
        $problems[0] | Should -Match 'Only 1 GB of free disk space for installers and backups'
    }

    It 'reports a deploy drive it can''t measure as a problem, not an error' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { throw 'The drive cannot be found.' } -ParameterFilter { $Path -eq $TestDrive }
        (@(Test-StationReady @ready) -join "`n") | Should -Match 'Could not read free disk space for installers and backups'
    }

    It 'doesn''t stop for a scans drive it can''t measure' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { throw 'Could not find item.' } -ParameterFilter { $Path -eq $scans }
        @(Test-StationReady @ready) | Should -HaveCount 0
        # The settings check never measures the scans drive; that's the health line's job.
        Should -Invoke -ModuleName StationChecks Get-FreeDiskGB -Times 0 -Exactly -ParameterFilter { $Path -eq $scans }
    }

    It 'reports a missing .env' {
        Remove-Item -LiteralPath (Join-Path $userProfile '.bloom\.env')
        (@(Test-StationReady @ready) -join "`n") | Should -Match '.env is missing'
    }
}

Describe 'Get-ScansDriveHealth' {
    BeforeEach {
        $userProfile = New-StationProfile -EnvLines @('SCANS_DIR=E:\bloom-scans')
    }

    It 'says it didn''t check when .env has no SCANS_DIR' {
        Get-ScansDriveHealth -ProfileDir (New-StationProfile -EnvLines @('SCANNER_MODE=cylinderscan')) |
            Should -Be 'not checked (no SCANS_DIR in .env)'
    }

    It 'reports the free disk space' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { 250 }
        Get-ScansDriveHealth -ProfileDir $userProfile | Should -Be '250 GB of free disk space'
    }

    It 'warns when the drive is nearly full' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { 3 }
        Get-ScansDriveHealth -ProfileDir $userProfile | Should -Match '^only 3 GB of free disk space; scans may fail'
    }

    It 'says so when it can''t measure, without throwing' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { throw 'Could not find item E:\bloom-scans.' }
        Get-ScansDriveHealth -ProfileDir $userProfile | Should -Match '^could not read'
    }
}

Describe 'Get-FreeDiskGB' {
    It 'throws for a drive that doesn''t exist, instead of reading 0 GB' -Skip:($env:OS -ne 'Windows_NT') {
        # Not mocked: PowerShell turns DriveInfo's exception into $null, which read as 0 GB before.
        $unused = [char[]](68..90) | Where-Object { -not (Test-Path "${_}:\") } | Select-Object -First 1
        { Get-FreeDiskGB -Path "${unused}:\scans" } | Should -Throw "*doesn't exist or isn't ready*"
    }

    It 'gives a could-not-read health line for a drive that doesn''t exist' -Skip:($env:OS -ne 'Windows_NT') {
        $unused = [char[]](68..90) | Where-Object { -not (Test-Path "${_}:\") } | Select-Object -First 1
        $userProfile = New-StationProfile -EnvLines @("SCANS_DIR=${unused}:\bloom-scans")
        Get-ScansDriveHealth -ProfileDir $userProfile | Should -Match "^could not read: Drive ${unused}:\\ doesn't exist or isn't ready"
    }

    It 'measures a hidden folder''s drive (Get-Item can''t see hidden folders)' {
        $hidden = Join-Path $TestDrive ('hidden-' + [guid]::NewGuid())
        (New-Item -ItemType Directory -Force -Path $hidden).Attributes = 'Hidden, Directory'
        Get-FreeDiskGB -Path $hidden | Should -BeGreaterOrEqual 0
    }
}

Describe 'Test-CameraReachable' {
    It 'is false for a missing or mock camera without pinging' {
        Mock -ModuleName StationChecks Test-Connection { $true }
        Test-CameraReachable -Address '' | Should -BeFalse
        Test-CameraReachable -Address 'mock' | Should -BeFalse
        Should -Invoke -ModuleName StationChecks Test-Connection -Times 0
    }

    It 'follows the ping' {
        Mock -ModuleName StationChecks Test-Connection { $false }
        Test-CameraReachable -Address '10.0.0.45' | Should -BeFalse
        Mock -ModuleName StationChecks Test-Connection { $true }
        Test-CameraReachable -Address '10.0.0.45' | Should -BeTrue
    }
}

Describe 'Test-BloomAccess' {
    BeforeEach {
        $settings = @{
            BLOOM_API_URL = 'https://bloom.example.invalid/api/'; BLOOM_SCANNER_USERNAME = 'scanner@salk.edu'
            BLOOM_SCANNER_PASSWORD = 's3cret-password'; BLOOM_ANON_KEY = 'anon-key'
        }
        Mock -ModuleName StationChecks Invoke-RestMethod { [pscustomobject]@{ access_token = 'token' } } -ParameterFilter { $Method -eq 'Post' }
        Mock -ModuleName StationChecks Invoke-RestMethod { , @([pscustomobject]@{ id = 7 }) } -ParameterFilter { $Method -ne 'Post' }
    }

    It 'passes when the login works and the scanner is registered' {
        Test-BloomAccess -Settings $settings -ScannerName 'FastScanner' | Should -BeNullOrEmpty
        Should -Invoke -ModuleName StationChecks Invoke-RestMethod -ParameterFilter {
            $Uri -eq 'https://bloom.example.invalid/api/rest/v1/cyl_scanners?select=id&name=eq.FastScanner'
        }
    }

    It 'names a missing setting' {
        $settings.Remove('BLOOM_ANON_KEY')
        Test-BloomAccess -Settings $settings -ScannerName 'FastScanner' | Should -Match 'BLOOM_ANON_KEY is missing'
    }

    It 'reports a failed login without the password' {
        Mock -ModuleName StationChecks Invoke-RestMethod { throw 'Invalid login credentials' } -ParameterFilter { $Method -eq 'Post' }
        $problem = Test-BloomAccess -Settings $settings -ScannerName 'FastScanner'
        $problem | Should -Match "Bloom login with the station's saved account failed"
        $problem | Should -Not -Match 's3cret-password'
        $problem | Should -Not -Match 'scanner@salk.edu'
    }

    It 'reports a scanner that Bloom does not know, however the empty reply is wrapped' {
        foreach ($empty in @({ , @() }, { @() }, { $null })) {
            Mock -ModuleName StationChecks Invoke-RestMethod $empty -ParameterFilter { $Method -ne 'Post' }
            Test-BloomAccess -Settings $settings -ScannerName 'FastScanner' | Should -Match "Scanner 'FastScanner' is not registered"
        }
    }

    It 'finds the scanner whether the reply is wrapped or unrolled' {
        foreach ($rows in @({ , @([pscustomobject]@{ id = 7 }) }, { [pscustomobject]@{ id = 7 } })) {
            Mock -ModuleName StationChecks Invoke-RestMethod $rows -ParameterFilter { $Method -ne 'Post' }
            Test-BloomAccess -Settings $settings -ScannerName 'FastScanner' | Should -BeNullOrEmpty
        }
    }
}

Describe 'Compare-RowCounts' {
    It 'is quiet when no table lost rows, and allows new tables' {
        @(Compare-RowCounts -Before @{ Scan = 5; Image = 360 } -After @{ Scan = 5; Image = 361; NewTable = 0 }) | Should -HaveCount 0
    }

    It 'reports lost rows and missing tables' {
        $problems = @(Compare-RowCounts -Before @{ Scan = 5; Image = 360 } -After @{ Scan = 4 })
        $problems | Should -Contain 'Table Scan had 5 rows before the upgrade and 4 after.'
        $problems | Should -Contain 'Table Image is missing after the database upgrade.'
    }
}

Describe 'Protect-DeployText' {
    AfterEach { Set-DeployRedactions -Settings @{} }

    It 'replaces the station''s paths, account and .env details' {
        Set-DeployRedactions -Settings @{
            CAMERA_IP_ADDRESS = '10.0.0.45'; BLOOM_SCANNER_USERNAME = 'station@example.org'
            BLOOM_SCANNER_PASSWORD = 'hunter22'; BLOOM_API_URL = 'https://bloom.example.org/api'
        }
        $text = "Copy of $env:USERPROFILE\.bloom\data\bloom.db and $($env:LOCALAPPDATA -replace '\\', '/') failed; " +
            "camera 10.0.0.45, account station@example.org (hunter22), host bloom.example.org, user $env:USERNAME"
        $safe = Protect-DeployText -Text $text
        foreach ($secret in $env:USERPROFILE, $env:USERNAME, '10.0.0.45', 'station@example.org', 'hunter22', 'bloom.example.org') {
            $safe | Should -Not -Match ([regex]::Escape($secret))
        }
        $safe | Should -Match '%USERPROFILE%\\.bloom\\data\\bloom.db'
        $safe | Should -Match '%LOCALAPPDATA%'
    }

    It 'replaces the account name only as a whole word, never inside the backup path' {
        $savedUser = $env:USERNAME
        try {
            $env:USERNAME = 'bloom'
            $safe = Protect-DeployText -Text 'Restored bloom.db from C:\BloomDeploy\backups\20261022_v0.2.0 (run by bloom); data in .bloom\data, my-bloom-app. Done by bloom.'
            $safe | Should -Be 'Restored bloom.db from C:\BloomDeploy\backups\20261022_v0.2.0 (run by <lab account>); data in .bloom\data, my-bloom-app. Done by <lab account>.'
        }
        finally { $env:USERNAME = $savedUser }
    }

    It 'leaves placeholder settings such as the mock camera readable' {
        Set-DeployRedactions -Settings @{ CAMERA_IP_ADDRESS = 'mock'; BLOOM_SCANNER_PASSWORD = 'hunter22' }
        Protect-DeployText -Text 'CAMERA_IP_ADDRESS is mock; set the camera''s address (password hunter22).' |
            Should -Be 'CAMERA_IP_ADDRESS is mock; set the camera''s address (password <BLOOM_SCANNER_PASSWORD>).'
    }

    It 'is applied to every log line' {
        Set-DeployRedactions -Settings @{ CAMERA_IP_ADDRESS = '10.0.0.45' }
        $log = Join-Path $TestDrive ('log-' + [guid]::NewGuid() + '.log')
        Set-DeployLogFile -Path $log
        try { Write-DeployLog -Message 'camera 10.0.0.45 did not answer' }
        finally { Set-DeployLogFile -Path '' }
        Get-Content -Raw $log | Should -Not -Match '10\.0\.0\.45'
    }
}

Describe 'Update-StationDatabase' {
    BeforeEach {
        $log = Join-Path $TestDrive ('log-' + [guid]::NewGuid() + '.log')
        Set-DeployLogFile -Path $log
        $db = Join-Path $TestDrive 'profile\.bloom\data\bloom.db'
        $common = @{ DatabasePath = $db; SchemaPath = 'C:\release\prisma\schema.prisma'; ToolsDir = 'C:\tools' }
    }
    AfterEach { Set-DeployLogFile -Path '' }

    It 'logs prisma''s output with the database path replaced' {
        Mock -ModuleName StationChecks Invoke-Node { $global:LASTEXITCODE = 0; "Datasource at $($db -replace '\\', '/')"; "Applied to $db" }
        Update-StationDatabase @common
        $text = Get-Content -Raw $log
        $text | Should -Match 'prisma: Datasource at bloom.db'
        $text | Should -Not -Match ([regex]::Escape($db))
    }

    It 'throws when prisma fails, so the deploy rolls back' {
        Mock -ModuleName StationChecks Invoke-Node { $global:LASTEXITCODE = 1; 'Error: P3009' }
        { Update-StationDatabase @common } | Should -Throw '*prisma migrate deploy exited 1*'
    }
}

Describe 'Get-DatabaseRowCounts' {
    It 'reads the JSON line and ignores warnings before it' {
        $db = Join-Path $TestDrive 'counts.db'
        Set-Content -LiteralPath $db -Value 'db'
        Mock -ModuleName StationChecks Invoke-Node { $global:LASTEXITCODE = 0; '(node:1) ExperimentalWarning: x'; '{"Scan": 6538, "Image": 470736}' }
        $counts = Get-DatabaseRowCounts -DatabasePath $db -ToolsDir 'C:\tools'
        $counts['Scan'] | Should -Be 6538
        $counts['Image'] | Should -Be 470736
    }

    It 'throws when counting fails' {
        $db = Join-Path $TestDrive 'locked.db'
        Set-Content -LiteralPath $db -Value 'db'
        Mock -ModuleName StationChecks Invoke-Node { $global:LASTEXITCODE = 1; 'SQLITE_BUSY: database is locked' }
        { Get-DatabaseRowCounts -DatabasePath $db -ToolsDir 'C:\tools' } | Should -Throw '*database is locked*'
    }
}
