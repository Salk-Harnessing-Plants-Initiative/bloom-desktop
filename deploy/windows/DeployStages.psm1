# DeployStages.psm1: what the deploy shows while it runs. Each stage of a deploy is a named,
# timed section of the job log (a collapsible ::group:: on GitHub), long waits print a line
# every minute so the run never looks stuck, and Find-BloomUpload checks that the test
# upload really reached Bloom.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

# Without -Force: reuse the instance BloomDeploy.psm1 loaded, which holds the log redactions.
Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1')

# How often a long wait says it's still waiting.
$script:ProgressIntervalSeconds = 60
$script:BloomRequestTimeoutSeconds = 30
$script:CurrentStage = $null

function Format-Duration {
    param([Parameter(Mandatory)][TimeSpan]$Span)
    if ($Span.TotalMinutes -ge 1) { return '{0}m{1:00}s' -f [int][math]::Floor($Span.TotalMinutes), $Span.Seconds }
    '{0}s' -f [int][math]::Round($Span.TotalSeconds)
}

function Start-DeployStage {
    <# Open a named section of the job log (closing any section still open). #>
    param([Parameter(Mandatory)][string]$Title)
    if ($script:CurrentStage) { Write-Host '::endgroup::' }
    $script:CurrentStage = [pscustomobject]@{ Title = $Title; Started = Get-Date }
    Write-Host "::group::$Title"
    Write-DeployLog "== $Title"
}

function Complete-DeployStage {
    <# Close the current section; returns "<result> (<time taken>)" for the job summary. #>
    param([Parameter(Mandatory)][string]$Result)
    if (-not $script:CurrentStage) { return $Result }
    $line = '{0} ({1})' -f $Result, (Format-Duration -Span ((Get-Date) - $script:CurrentStage.Started))
    Write-DeployLog "== $($script:CurrentStage.Title): $line"
    Write-Host '::endgroup::'
    $script:CurrentStage = $null
    $line
}

function Wait-ProcessWithProgress {
    <#
      Wait up to $TimeoutSeconds for $Process to exit, logging "still waiting" every minute.
      Returns $true if it exited, $false on timeout (the caller decides what to stop).
    #>
    param(
        [Parameter(Mandatory)]$Process,
        [Parameter(Mandatory)][int]$TimeoutSeconds,
        [Parameter(Mandatory)][string]$What
    )
    $started = Get-Date
    while ($true) {
        $left = $TimeoutSeconds - ((Get-Date) - $started).TotalSeconds
        if ($left -le 0) { return $false }
        if ($Process.WaitForExit([int]([math]::Min($left, $script:ProgressIntervalSeconds) * 1000))) { return $true }
        Write-DeployLog "Still waiting for $What ($(Format-Duration -Span ((Get-Date) - $started)) so far)."
    }
}

function Find-BloomUpload {
    <#
      Look up the self-test's plant in Bloom with the station's saved account and say what
      Bloom has for it: plant, experiment, scans and images. Nothing is written. Returns
      Found (bool) and Detail.
    #>
    param(
        [Parameter(Mandatory)][hashtable]$Settings,
        [Parameter(Mandatory)][string]$PlantId
    )
    try {
        $api = $Settings['BLOOM_API_URL'].TrimEnd('/')
        $headers = @{ apikey = $Settings['BLOOM_ANON_KEY'] }
        $body = @{ email = $Settings['BLOOM_SCANNER_USERNAME']; password = $Settings['BLOOM_SCANNER_PASSWORD'] } | ConvertTo-Json
        $session = Invoke-RestMethod -Method Post -Uri "$api/auth/v1/token?grant_type=password" -Headers $headers `
            -Body $body -ContentType 'application/json' -TimeoutSec $script:BloomRequestTimeoutSeconds
        $headers['Authorization'] = "Bearer $($session.access_token)"
        $select = 'id,qr_code,cyl_waves(cyl_experiments(id,name)),cyl_scans(id,cyl_images(id))'
        $uri = "$api/rest/v1/cyl_plants?select=$select&qr_code=eq.$([uri]::EscapeDataString($PlantId))"
        $plants = @(Invoke-RestMethod -Uri $uri -Headers $headers -TimeoutSec $script:BloomRequestTimeoutSeconds |
            ForEach-Object { $_ } | Where-Object { $null -ne $_ -and $null -ne $_.id })
    }
    catch {
        return [pscustomobject]@{ Found = $false; Detail = "couldn't ask Bloom: $($_.Exception.Message)" }
    }
    if ($plants.Count -eq 0) { return [pscustomobject]@{ Found = $false; Detail = "plant $PlantId not found in Bloom" } }
    $plant = $plants[0]
    $experiment = @($plant.cyl_waves | ForEach-Object { $_.cyl_experiments }) | Select-Object -First 1
    $scans = @($plant.cyl_scans)
    $images = @($scans | ForEach-Object { @($_.cyl_images) } | Where-Object { $null -ne $_ }).Count
    $where = if ($experiment) { "experiment '$($experiment.name)' (id $($experiment.id))" } else { 'no experiment' }
    [pscustomobject]@{
        Found  = $true
        Detail = "plant $PlantId (id $($plant.id)) in $where with $($scans.Count) scan(s) and $images image(s)"
    }
}

Export-ModuleMember -Function Start-DeployStage, Complete-DeployStage, Wait-ProcessWithProgress, Find-BloomUpload
