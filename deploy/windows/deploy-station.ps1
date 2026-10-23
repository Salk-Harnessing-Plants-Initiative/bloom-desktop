# Deploy a Bloom Desktop release on this station. Run by the Deploy workflow on the
# station's self-hosted runner; see docs/STATION_SETUP.md.
#
#   deploy-station.ps1 -Version 0.2.1 -ScannerName <name> -ReleaseBaseUrl <url> `
#     -TestSpecies Sorghum -SchemaPath <release>\prisma\schema.prisma -ToolsDir <dir> [-RequireCamera]
#
# Exit codes: 0 deployed; 1 not deployed (the reason is in the log and the job summary).

param(
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][string]$ScannerName,
    [Parameter(Mandatory)][string]$ReleaseBaseUrl,
    [Parameter(Mandatory)][string]$TestSpecies,
    [Parameter(Mandatory)][string]$SchemaPath,
    [Parameter(Mandatory)][string]$ToolsDir,
    [switch]$RequireCamera
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 on a stock station may not offer TLS 1.2 (GitHub and Bloom need it),
# and its download progress bar slows large downloads many times over.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'BloomDeploy.psm1') -Force
# Already loaded by BloomDeploy; imported here too for Protect-DeployText. Without -Force, so
# it is the same instance and has the redactions BloomDeploy set from .env.
Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1')

try {
    $result = Invoke-StationDeploy -Version $Version -ScannerName $ScannerName -ReleaseBaseUrl $ReleaseBaseUrl `
        -TestSpecies $TestSpecies -SchemaPath $SchemaPath -ToolsDir $ToolsDir -RequireCamera:$RequireCamera
}
catch {
    # An unexpected error, most often a download, checksum or backup failure before
    # anything changed. The log says how far the deploy got.
    $installed = $null
    try { $installed = Get-InstalledVersion -LocalAppData $env:LOCALAPPDATA } catch { }
    $result = [pscustomobject]@{
        Status = 'error'; Version = $Version; Previous = $installed; Checks = @{}
        Problems = @(Protect-DeployText -Text "The deploy stopped: $($_.Exception.Message) See the attached station log for how far it got.")
    }
}

# Hand this run's log (only this one) to the workflow, which attaches it to the run.
$logFile = $env:BLOOM_DEPLOY_LOG_FILE
if ($logFile -and $env:DEPLOY_LOG_DIR -and (Test-Path -LiteralPath $logFile)) {
    New-Item -ItemType Directory -Force -Path $env:DEPLOY_LOG_DIR | Out-Null
    Copy-Item -LiteralPath $logFile -Destination $env:DEPLOY_LOG_DIR -ErrorAction SilentlyContinue
}

if ($env:GITHUB_STEP_SUMMARY) {
    $previous = if ($result.Previous) { "v$($result.Previous)" } else { 'none' }
    $label = if ($result.Status -eq 'error') { 'Installed now' } else { 'Previously installed' }
    $summary = @("## Deploy v$Version", '', "- Result: **$($result.Status)**", "- ${label}: $previous")
    if ($result.Checks.Count -gt 0) {
        $summary += '', '| Check | Result |', '|---|---|'
        # The summary is public: check values are redacted like the problems, and kept to one table cell.
        foreach ($name in $result.Checks.Keys) {
            $value = (Protect-DeployText -Text "$($result.Checks[$name])") -replace '[|\r\n]', ' '
            $summary += "| $name | $value |"
        }
    }
    if ($result.Problems.Count -gt 0) { $summary += '' }
    foreach ($problem in $result.Problems) { $summary += "- Problem: $problem" }
    if ($result.Status -eq 'deployed') {
        $summary += '', 'Next: when the camera is on, check the preview and a scan on the station.'
    }
    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $summary
}

if ($result.Status -ne 'deployed') { exit 1 }
exit 0
