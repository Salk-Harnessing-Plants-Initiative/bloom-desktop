# Job-started hook for a station's self-hosted runner. The runner runs it before every
# job (ACTIONS_RUNNER_HOOK_JOB_STARTED in the runner's .env); a non-zero exit fails the
# job before any of its steps run.
#
# It lets through only this repository's Deploy workflow from main, started by hand.
# Runner groups can't be limited to a workflow on the organization's GitHub plan, and the
# repository is public, so without this any workflow naming the station's labels (from a
# fork pull request or a pushed branch) would run on the station as the lab account.
#
# Install: copy this file and RunnerJobCheck.psm1 to C:\actions-runner\hooks\ (see
# docs/STATION_SETUP.md). Changes must be copied to the station again by hand; the runner
# never reads them from Git.

# Fail closed: if the check can't load or run, the job is refused.
$ErrorActionPreference = 'Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'RunnerJobCheck.psm1') -Force
    $jobEnv = @{
        GITHUB_REPOSITORY   = $env:GITHUB_REPOSITORY
        GITHUB_WORKFLOW_REF = $env:GITHUB_WORKFLOW_REF
        GITHUB_EVENT_NAME   = $env:GITHUB_EVENT_NAME
    }
    $refusal = Get-DeployJobRefusal -JobEnv $jobEnv
}
catch {
    $refusal = "the job check failed to run ($($_.Exception.Message))"
}
if ($refusal) {
    Write-Host "Refused by the station's job hook: $refusal. Only the Deploy workflow from main may run on a station."
    exit 1
}
Write-Host 'Station job hook: Deploy workflow from main, allowed.'
exit 0
