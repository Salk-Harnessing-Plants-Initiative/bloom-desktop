# Pester 5 tests for deploy/windows/DeployStages.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# Bloom is mocked; nothing is sent anywhere.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\DeployStages.psm1') -Force

    $script:settings = @{
        BLOOM_API_URL = 'https://bloom.example.invalid/api/'; BLOOM_ANON_KEY = 'anon'
        BLOOM_SCANNER_USERNAME = 'station@example.org'; BLOOM_SCANNER_PASSWORD = 'secret'
    }
}

Describe 'Start-DeployStage and Complete-DeployStage' {
    BeforeEach {
        $script:hostLines = [System.Collections.Generic.List[string]]::new()
        Mock -ModuleName DeployStages Write-Host { $script:hostLines.Add("$Object") }
        Mock -ModuleName DeployStages Write-DeployLog { }
    }

    It 'opens a section of the job log and returns the result with the time taken' {
        Start-DeployStage 'Install v0.2.1'
        Complete-DeployStage 'v0.2.1 installed' | Should -Match '^v0\.2\.1 installed \(\d+s\)$'
        $script:hostLines | Should -Be @('::group::Install v0.2.1', '::endgroup::')
    }

    It 'closes the open section when the next one starts' {
        Start-DeployStage 'One'
        Start-DeployStage 'Two'
        Complete-DeployStage 'done' | Out-Null
        $script:hostLines | Should -Be @('::group::One', '::endgroup::', '::group::Two', '::endgroup::')
    }

    It 'does nothing more when no section is open' {
        Complete-DeployStage 'stopped' | Should -Be 'stopped'
        $script:hostLines | Should -HaveCount 0
    }
}

Describe 'Wait-ProcessWithProgress' {
    BeforeEach {
        $script:logged = [System.Collections.Generic.List[string]]::new()
        Mock -ModuleName DeployStages Write-DeployLog { $script:logged.Add($Message) }
    }

    It 'returns true when the process exits, logging a line for each minute it waited' {
        $script:waits = 0
        $process = [pscustomobject]@{} | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
            param($ms) $script:waits++; $script:waits -ge 3 } -PassThru
        Wait-ProcessWithProgress -Process $process -TimeoutSeconds 600 -What 'the installer' | Should -BeTrue
        $script:logged | Should -HaveCount 2
        $script:logged[0] | Should -BeLike 'Still waiting for the installer (*so far).'
    }

    It 'returns false at the time limit' {
        $process = [pscustomobject]@{} | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($ms) $false } -PassThru
        Wait-ProcessWithProgress -Process $process -TimeoutSeconds 0 -What 'the installer' | Should -BeFalse
    }
}

Describe 'Find-BloomUpload' {
    BeforeEach {
        Mock -ModuleName DeployStages Invoke-RestMethod { [pscustomobject]@{ access_token = 'token' } } -ParameterFilter { $Method -eq 'Post' }
    }

    It 'describes the plant, experiment, scans and images Bloom has for the test upload' {
        Mock -ModuleName DeployStages Invoke-RestMethod {
            , @([pscustomobject]@{
                    id = 9; qr_code = 'DEPLOY-0.2.1-1'
                    cyl_waves = [pscustomobject]@{ cyl_experiments = [pscustomobject]@{ id = 3; name = 'DEPLOY-TEST PC1Scanner' } }
                    cyl_scans = @([pscustomobject]@{ id = 5; cyl_images = @([pscustomobject]@{ id = 1 }, [pscustomobject]@{ id = 2 }, [pscustomobject]@{ id = 3 }) })
                })
        } -ParameterFilter { $Method -ne 'Post' }
        $found = Find-BloomUpload -Settings $script:settings -PlantId 'DEPLOY-0.2.1-1'
        $found.Found | Should -BeTrue
        $found.Detail | Should -Be "plant DEPLOY-0.2.1-1 (id 9) in experiment 'DEPLOY-TEST PC1Scanner' (id 3) with 1 scan(s) and 3 image(s)"
        Should -Invoke -ModuleName DeployStages Invoke-RestMethod -ParameterFilter {
            $Uri -like 'https://bloom.example.invalid/api/rest/v1/cyl_plants?*qr_code=eq.DEPLOY-0.2.1-1' -and $Headers['Authorization'] -eq 'Bearer token'
        }
    }

    It 'says so when Bloom has no such plant' {
        Mock -ModuleName DeployStages Invoke-RestMethod { , @() } -ParameterFilter { $Method -ne 'Post' }
        $found = Find-BloomUpload -Settings $script:settings -PlantId 'DEPLOY-0.2.1-1'
        $found.Found | Should -BeFalse
        $found.Detail | Should -Be 'plant DEPLOY-0.2.1-1 not found in Bloom'
    }

    It 'reports a failed lookup instead of throwing' {
        Mock -ModuleName DeployStages Invoke-RestMethod { throw 'Invalid login credentials' } -ParameterFilter { $Method -eq 'Post' }
        $found = Find-BloomUpload -Settings $script:settings -PlantId 'DEPLOY-0.2.1-1'
        $found.Found | Should -BeFalse
        $found.Detail | Should -BeLike "couldn't ask Bloom: *Invalid login credentials*"
    }
}
