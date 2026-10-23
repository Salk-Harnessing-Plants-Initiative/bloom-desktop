# Pester 5 tests for deploy/windows/SelfTest.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# The app process is mocked; files live in TestDrive.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\SelfTest.psm1') -Force

    function New-StationProfile {
        $userProfile = Join-Path $TestDrive ('profile-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path (Join-Path $userProfile '.bloom\data') | Out-Null
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db') -Value 'db'
        $userProfile
    }
}

Describe 'Invoke-DeploySelfTest' {
    BeforeEach {
        $userProfile = New-StationProfile
        $work = Join-Path $TestDrive ('work-' + [guid]::NewGuid())
        $resultFile = Join-Path $work 'self-test-result.json'
        $common = @{ LocalAppData = 'C:\lad'; ProfileDir = $userProfile; Species = 'Sorghum'; WorkDir = $work }
        $script:writeResult = $null
        Mock -ModuleName SelfTest Stop-Process { }
        Mock -ModuleName SelfTest Start-Process {
            if ($script:writeResult) { Set-Content -LiteralPath $resultFile -Value $script:writeResult }
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = 0 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
    }

    It 'skips versions without the self-test' {
        (Invoke-DeploySelfTest -Version '0.2.0' @common).Status | Should -Be 'not-supported'
        Should -Invoke -ModuleName SelfTest Start-Process -Times 0
    }

    It 'runs the versioned exe on a copy and passes on an uploaded result' {
        $script:writeResult = '{"ok": true, "uploaded": 3, "frames": 3, "plantId": "DEPLOY-0.2.1-1", "experiment": "DEPLOY-TEST PC1Scanner"}'
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'passed'
        $result.Detail | Should -Be "uploaded 3 of 3 frames as plant DEPLOY-0.2.1-1 in experiment 'DEPLOY-TEST PC1Scanner'"
        $result.PlantId | Should -Be 'DEPLOY-0.2.1-1'
        Should -Invoke -ModuleName SelfTest Start-Process -ParameterFilter {
            $FilePath -eq 'C:\lad\bloom_desktop\app-0.2.1\Bloom Desktop.exe' -and
            ($ArgumentList -join ' ') -match '--deploy-self-test' -and ($ArgumentList -join ' ') -match 'self-test-copy\.db'
        }
        Test-Path (Join-Path $work 'self-test-copy.db') | Should -BeFalse
    }

    It 'runs a pre-release from its installer folder name' {
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-rc.1-1"}'
        (Invoke-DeploySelfTest -Version '0.2.1-rc.1' @common).Status | Should -Be 'passed'
        Should -Invoke -ModuleName SelfTest Start-Process -ParameterFilter {
            $FilePath -eq 'C:\lad\bloom_desktop\app-0.2.1-rc1\Bloom Desktop.exe'
        }
    }

    It 'fails with the upload errors' {
        $script:writeResult = '{"ok": false, "uploaded": 0, "plantId": "DEPLOY-0.2.1-2", "errors": ["Authentication failed: Invalid login credentials"]}'
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'failed'
        $result.Problems | Should -Contain 'Self-test upload failed: Authentication failed: Invalid login credentials'
    }

    It 'reads a result from an app that writes fewer fields' {
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-4"}'
        (Invoke-DeploySelfTest -Version '0.2.1' @common).Detail | Should -Be 'uploaded 3 frames as plant DEPLOY-0.2.1-4'
    }

    It 'fails when no result file is written' {
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Status | Should -Be 'failed'
        $result.Problems[0] | Should -Match 'wrote no result'
    }

    It 'points to the runner-session fallback when the app crashes at start' {
        Mock -ModuleName SelfTest Start-Process {
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = -2147483645 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $true } -PassThru
        }
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Problems[0] | Should -Match "couldn't start in the runner's session"
    }

    It 'waits for the self-test''s helper processes before returning' {
        Mock -ModuleName SelfTest Wait-SelfTestProcessesExit { }
        $script:writeResult = '{"ok": true, "uploaded": 3, "plantId": "DEPLOY-0.2.1-3"}'
        Invoke-DeploySelfTest -Version '0.2.1' @common | Out-Null
        Should -Invoke -ModuleName SelfTest Wait-SelfTestProcessesExit -Times 1 -Exactly -ParameterFilter { $ParentId -eq 42 }
    }

    It 'stops the app and fails when it runs too long' {
        Mock -ModuleName SelfTest Wait-ProcessWithProgress { $false }
        Mock -ModuleName SelfTest Start-Process {
            [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = 0 } |
                Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $false } -PassThru
        }
        $result = Invoke-DeploySelfTest -Version '0.2.1' @common
        $result.Detail | Should -Be 'timed out'
        Should -Invoke -ModuleName SelfTest Stop-Process -Times 1
    }
}

Describe 'Wait-SelfTestProcessesExit' {
    BeforeEach {
        Mock -ModuleName SelfTest Start-Sleep { }
        Mock -ModuleName SelfTest Stop-Process { }
        Mock -ModuleName SelfTest Wait-Process { }
    }

    It 'returns once the helper processes have exited, without stopping anything' {
        $script:polls = 0
        Mock -ModuleName SelfTest Get-CimInstance {
            $script:polls++
            if ($script:polls -le 2) { [pscustomobject]@{ ProcessId = 7 } }
        }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 5
        $script:polls | Should -Be 3
        Should -Invoke -ModuleName SelfTest Stop-Process -Times 0 -Exactly
    }

    It 'stops helper processes still running at the time limit' {
        Mock -ModuleName SelfTest Get-CimInstance { [pscustomobject]@{ ProcessId = 7 } }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 0
        Should -Invoke -ModuleName SelfTest Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -eq 7 }
    }

    It 'only looks at the self-test''s own children' {
        Mock -ModuleName SelfTest Get-CimInstance { }
        Wait-SelfTestProcessesExit -ParentId 42 -TimeoutSeconds 0
        Should -Invoke -ModuleName SelfTest Get-CimInstance -ParameterFilter { $Filter -match 'ParentProcessId = 42' -and $Filter -match 'Bloom Desktop\.exe' }
    }
}
