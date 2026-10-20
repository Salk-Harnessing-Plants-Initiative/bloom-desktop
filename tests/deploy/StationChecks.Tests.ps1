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
        try { { Write-DeployLog -Message 'hello' } | Should -Not -Throw }
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
        $problem | Should -Match 'Bloom login failed for scanner@salk.edu'
        $problem | Should -Not -Match 's3cret-password'
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
