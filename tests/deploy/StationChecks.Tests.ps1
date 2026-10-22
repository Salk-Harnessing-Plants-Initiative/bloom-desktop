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

    It 'checks free space on the scans drive and the deploy drive' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { 3 } -ParameterFilter { $Path -eq $scans }
        Mock -ModuleName StationChecks Get-FreeDiskGB { 1 } -ParameterFilter { $Path -eq $TestDrive }
        $text = @(Test-StationReady @ready) -join "`n"
        $text | Should -Match 'Only 3 GB free for scans'
        $text | Should -Match 'Only 1 GB free for installers and backups'
    }

    It 'reports free space it can''t measure as a problem, not an error' {
        Mock -ModuleName StationChecks Get-FreeDiskGB { throw 'The drive cannot be found.' } -ParameterFilter { $Path -eq $scans }
        $text = @(Test-StationReady @ready) -join "`n"
        $text | Should -Match "Can't measure free space on the drive for scans"
    }

    It 'reports a missing .env' {
        Remove-Item -LiteralPath (Join-Path $userProfile '.bloom\.env')
        (@(Test-StationReady @ready) -join "`n") | Should -Match '.env is missing'
    }
}

Describe 'Get-FreeDiskGB' {
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

Describe 'Invoke-DeploySelfTest' {
    BeforeEach {
        $userProfile = New-StationProfile
        $work = Join-Path $TestDrive ('work-' + [guid]::NewGuid())
        $resultFile = Join-Path $work 'self-test-result.json'
        $common = @{ LocalAppData = 'C:\lad'; ProfileDir = $userProfile; Species = 'Sorghum'; WorkDir = $work }
        $script:writeResult = $null
        Mock -ModuleName StationChecks Stop-Process { }
        Mock -ModuleName StationChecks Start-Process {
            if ($script:writeResult) { Set-Content -LiteralPath $resultFile -Value $script:writeResult }
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = 0 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
    }

    It 'skips versions without the self-test' {
        (Invoke-DeploySelfTest -Version '0.2.0' @common).Status | Should -Be 'not-supported'
        Should -Invoke -ModuleName StationChecks Start-Process -Times 0
    }

    It 'runs the versioned exe on a copy and passes on an uploaded result' {
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-1"}'
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'passed'
        $result.Detail | Should -Match 'DEPLOY-0.2.1-1'
        Should -Invoke -ModuleName StationChecks Start-Process -ParameterFilter {
            $FilePath -eq 'C:\lad\bloom_desktop\app-0.2.1\Bloom Desktop.exe' -and
            ($ArgumentList -join ' ') -match '--deploy-self-test' -and ($ArgumentList -join ' ') -match 'self-test-copy\.db'
        }
        Test-Path (Join-Path $work 'self-test-copy.db') | Should -BeFalse
    }

    It 'runs a pre-release from its installer folder name' {
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-rc.1-1"}'
        (Invoke-DeploySelfTest -Version '0.2.1-rc.1' @common).Status | Should -Be 'passed'
        Should -Invoke -ModuleName StationChecks Start-Process -ParameterFilter {
            $FilePath -eq 'C:\lad\bloom_desktop\app-0.2.1-rc1\Bloom Desktop.exe'
        }
    }

    It 'fails with the upload errors' {
        $script:writeResult = '{"ok": false, "uploaded": 0, "plantId": "DEPLOY-0.2.1-2", "errors": ["Authentication failed: Invalid login credentials"]}'
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'failed'
        $result.Problems | Should -Contain 'Self-test upload failed: Authentication failed: Invalid login credentials'
    }

    It 'fails when no result file is written' {
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'failed'
        $result.Problems[0] | Should -Match 'wrote no result'
    }

    It 'points to the runner-session fallback when the app crashes at start' {
        Mock -ModuleName StationChecks Start-Process {
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = -2147483645 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Problems[0] | Should -Match "couldn't start in the runner's session"
    }

    It 'waits for the self-test''s helper processes before returning' {
        Mock -ModuleName StationChecks Wait-SelfTestProcessesExit { }
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-3"}'
        Invoke-DeploySelfTest -Version '0.2.1' @common | Out-Null
        Should -Invoke -ModuleName StationChecks Wait-SelfTestProcessesExit -Times 1 -Exactly -ParameterFilter { $ParentId -eq 42 }
    }

    It 'stops the app and fails when it runs too long' {
        Mock -ModuleName StationChecks Start-Process {
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = 0 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $false } -PassThru
        }
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Detail | Should -Be 'timed out'
        Should -Invoke -ModuleName StationChecks Stop-Process -Times 1
    }
}

Describe 'Wait-SelfTestProcessesExit' {
    BeforeEach {
        Mock -ModuleName StationChecks Start-Sleep { }
        Mock -ModuleName StationChecks Stop-Process { }
        Mock -ModuleName StationChecks Wait-Process { }
    }

    It 'returns once the helper processes have exited, without stopping anything' {
        $script:polls = 0
        Mock -ModuleName StationChecks Get-CimInstance {
            $script:polls++
            if ($script:polls -le 2) { [pscustomobject]@{ ProcessId = 7 } }
        }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 5
        $script:polls | Should -Be 3
        Should -Invoke -ModuleName StationChecks Stop-Process -Times 0 -Exactly
    }

    It 'stops helper processes still running at the time limit' {
        Mock -ModuleName StationChecks Get-CimInstance { [pscustomobject]@{ ProcessId = 7 } }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 0
        Should -Invoke -ModuleName StationChecks Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -eq 7 }
    }

    It 'only looks at the self-test''s own children' {
        Mock -ModuleName StationChecks Get-CimInstance { }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 0
        Should -Invoke -ModuleName StationChecks Get-CimInstance -ParameterFilter { $Filter -match 'ParentProcessId = 42' -and $Filter -match 'Bloom Desktop\.exe' }
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
