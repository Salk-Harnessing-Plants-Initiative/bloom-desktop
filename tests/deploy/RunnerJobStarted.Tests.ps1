# Pester 5 tests for deploy/windows/RunnerJobCheck.psm1, used by the station runner's
# job-started hook (runner-job-started.ps1) to let only the Deploy workflow from main run.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\RunnerJobCheck.psm1') -Force

    function New-JobEnv {
        param([hashtable]$Overrides = @{})
        $jobEnv = @{
            GITHUB_REPOSITORY   = 'Salk-Harnessing-Plants-Initiative/bloom-desktop'
            GITHUB_WORKFLOW_REF = 'Salk-Harnessing-Plants-Initiative/bloom-desktop/.github/workflows/deploy.yml@refs/heads/main'
            GITHUB_EVENT_NAME   = 'workflow_dispatch'
        }
        foreach ($key in $Overrides.Keys) { $jobEnv[$key] = $Overrides[$key] }
        $jobEnv
    }
}

Describe 'Get-DeployJobRefusal' {
    It 'allows the Deploy workflow from main, started by hand' {
        Get-DeployJobRefusal -JobEnv (New-JobEnv) | Should -BeNullOrEmpty
    }

    It 'refuses another repository, such as a fork' {
        Get-DeployJobRefusal -JobEnv (New-JobEnv @{ GITHUB_REPOSITORY = 'someone/bloom-desktop' }) |
            Should -Match "repository 'someone/bloom-desktop'"
    }

    It 'refuses any other workflow file' {
        Get-DeployJobRefusal -JobEnv (New-JobEnv @{
                GITHUB_WORKFLOW_REF = 'Salk-Harnessing-Plants-Initiative/bloom-desktop/.github/workflows/pr-checks.yml@refs/heads/main'
            }) | Should -Match 'pr-checks.yml'
    }

    It 'refuses the Deploy workflow from another branch or a pull request' {
        foreach ($ref in 'refs/heads/feature', 'refs/pull/7/merge') {
            Get-DeployJobRefusal -JobEnv (New-JobEnv @{
                    GITHUB_WORKFLOW_REF = "Salk-Harnessing-Plants-Initiative/bloom-desktop/.github/workflows/deploy.yml@$ref"
                }) | Should -Not -BeNullOrEmpty
        }
    }

    It 'refuses other events' {
        Get-DeployJobRefusal -JobEnv (New-JobEnv @{ GITHUB_EVENT_NAME = 'pull_request' }) |
            Should -Match "event 'pull_request'"
    }

    It 'refuses when the job details are missing' {
        Get-DeployJobRefusal -JobEnv @{} | Should -Not -BeNullOrEmpty
    }
}
