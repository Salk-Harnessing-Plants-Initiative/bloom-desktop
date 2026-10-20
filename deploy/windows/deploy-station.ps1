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

try {
    $result = Invoke-StationDeploy -Version $Version -ScannerName $ScannerName -ReleaseBaseUrl $ReleaseBaseUrl `
        -TestSpecies $TestSpecies -SchemaPath $SchemaPath -ToolsDir $ToolsDir -RequireCamera:$RequireCamera
}
catch {
    # Download, checksum and backup failures stop the deploy before anything changes.
    $result = [pscustomobject]@{
        Status = 'error'; Version = $Version; Previous = $null; Checks = @{}
        Problems = @("The deploy stopped: $($_.Exception.Message) See the attached station log.")
    }
}

if ($env:GITHUB_STEP_SUMMARY) {
    $previous = if ($result.Previous) { "v$($result.Previous)" } else { 'none' }
    $summary = @("## Deploy v$Version", '', "- Result: **$($result.Status)**", "- Previously installed: $previous")
    if ($result.Checks.Count -gt 0) {
        $summary += '', '| Check | Result |', '|---|---|'
        foreach ($name in $result.Checks.Keys) { $summary += "| $name | $($result.Checks[$name]) |" }
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
