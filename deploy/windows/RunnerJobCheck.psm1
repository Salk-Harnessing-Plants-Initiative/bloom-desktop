# RunnerJobCheck.psm1: which jobs a station's runner may run. Used by
# runner-job-started.ps1 (the runner's job-started hook) and by its tests.

Set-StrictMode -Version Latest

$script:AllowedRepository = 'Salk-Harnessing-Plants-Initiative/bloom-desktop'
$script:AllowedWorkflowRef = "$script:AllowedRepository/.github/workflows/deploy.yml@refs/heads/main"
$script:AllowedEvent = 'workflow_dispatch'

function Get-DeployJobRefusal {
    <# Why this job may not run on the station, or $null if it may. #>
    param([Parameter(Mandatory)][hashtable]$JobEnv)
    if ($JobEnv['GITHUB_REPOSITORY'] -ne $script:AllowedRepository) {
        return "repository '$($JobEnv['GITHUB_REPOSITORY'])' is not $script:AllowedRepository"
    }
    if ($JobEnv['GITHUB_WORKFLOW_REF'] -ne $script:AllowedWorkflowRef) {
        return "workflow '$($JobEnv['GITHUB_WORKFLOW_REF'])' is not $script:AllowedWorkflowRef"
    }
    if ($JobEnv['GITHUB_EVENT_NAME'] -ne $script:AllowedEvent) {
        return "event '$($JobEnv['GITHUB_EVENT_NAME'])' is not $script:AllowedEvent"
    }
    $null
}

Export-ModuleMember -Function Get-DeployJobRefusal
