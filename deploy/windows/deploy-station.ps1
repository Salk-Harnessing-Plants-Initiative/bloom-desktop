# Deploy a Bloom Desktop release on this station. Run by the Deploy workflow on the
# station's self-hosted runner; see docs/STATION_SETUP.md.
#
#   deploy-station.ps1 -Version 0.2.0 -ScannerName <name> -ReleaseBaseUrl <url>
#
# Exit codes: 0 deployed; 1 not deployed (the reason is in the log and the job summary).

param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$ScannerName,
    [Parameter(Mandatory)][string]$ReleaseBaseUrl
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'BloomDeploy.psm1') -Force

$result = Invoke-StationDeploy -Version $Version -ScannerName $ScannerName -ReleaseBaseUrl $ReleaseBaseUrl

if ($env:GITHUB_STEP_SUMMARY) {
    $previous = if ($result.Previous) { "v$($result.Previous)" } else { 'none' }
    $summary = @("## Deploy v$Version", '', "- Result: **$($result.Status)**", "- Previously installed: $previous")
    foreach ($problem in $result.Problems) { $summary += "- Problem: $problem" }
    if ($result.Status -eq 'deployed') { $summary += '', 'Next: the operator opens Bloom Desktop and checks preview, a scan and the Bloom upload.' }
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $summary
}

if ($result.Status -ne 'deployed') { exit 1 }
