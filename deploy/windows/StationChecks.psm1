# StationChecks.psm1: the checks BloomDeploy.psm1 runs around an install on a Windows
# CylinderScan station: camera and Bloom access before anything changes, the database
# upgrade after installing, and the installed app's upload self-test.
#
# Secrets from .env (Bloom password, anon key) are only sent to the station's own Bloom
# URL and are never written to the log or the job summary.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

$script:CameraPingCount = 2
$script:BloomRequestTimeoutSeconds = 30
# The app's own time limit is 180 s; this is the backstop if the process hangs.
$script:SelfTestTimeoutSeconds = 240
# The first release whose app has --deploy-self-test.
$script:SelfTestMinVersion = [version]'0.2.1'
$script:LogFile = $null

function Set-DeployLogFile {
    param([string]$Path)
    $script:LogFile = $Path
}

function Write-DeployLog {
    param([Parameter(Mandatory)][string]$Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    # Write-Host, not Write-Output, so log lines never mix into a function's return value.
    Write-Host $line
    if ($script:LogFile) { Add-Content -Path $script:LogFile -Value $line }
}

function Invoke-Node {
    <#
      Run node with arguments; returns stdout lines and sets $LASTEXITCODE. Tools like
      Prisma write warnings to stderr, which Windows PowerShell 5.1 would otherwise turn
      into a terminating error, so only the exit code decides success.
    #>
    param([Parameter(Mandatory)][string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & node @Arguments 2>&1 | ForEach-Object { "$_" } }
    finally { $ErrorActionPreference = $previous }
}

function Read-StationEnv {
    <# ~/.bloom/.env as a hashtable; empty when the file is missing. #>
    param([Parameter(Mandatory)][string]$ProfileDir)
    $settings = @{}
    $envFile = Join-Path $ProfileDir '.bloom\.env'
    if (-not (Test-Path -LiteralPath $envFile)) { return $settings }
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $settings[$Matches[1]] = $Matches[2].Trim('"') }
    }
    $settings
}

function Test-CameraReachable {
    param([string]$Address)
    if (-not $Address -or $Address -eq 'mock') { return $false }
    [bool](Test-Connection -ComputerName $Address -Count $script:CameraPingCount -Quiet -ErrorAction SilentlyContinue)
}

function Test-BloomAccess {
    <#
      Log in to Bloom with the station's saved credentials and read its scanner row,
      as the app does. Nothing is written. Returns a problem string, or $null when fine.
    #>
    param(
        [Parameter(Mandatory)][hashtable]$Settings,
        [Parameter(Mandatory)][string]$ScannerName
    )
    foreach ($key in 'BLOOM_API_URL', 'BLOOM_SCANNER_USERNAME', 'BLOOM_SCANNER_PASSWORD', 'BLOOM_ANON_KEY') {
        if (-not $Settings[$key]) { return "$key is missing from .env: set up Machine Configuration." }
    }
    $api = $Settings['BLOOM_API_URL'].TrimEnd('/')
    $headers = @{ apikey = $Settings['BLOOM_ANON_KEY'] }
    try {
        $body = @{ email = $Settings['BLOOM_SCANNER_USERNAME']; password = $Settings['BLOOM_SCANNER_PASSWORD'] } | ConvertTo-Json
        $session = Invoke-RestMethod -Method Post -Uri "$api/auth/v1/token?grant_type=password" -Headers $headers `
            -Body $body -ContentType 'application/json' -TimeoutSec $script:BloomRequestTimeoutSeconds
    }
    catch {
        return "Bloom login failed for $($Settings['BLOOM_SCANNER_USERNAME']): $($_.Exception.Message)"
    }
    try {
        $headers['Authorization'] = "Bearer $($session.access_token)"
        $name = [uri]::EscapeDataString($ScannerName)
        $response = Invoke-RestMethod -Uri "$api/rest/v1/cyl_scanners?select=id&name=eq.$name" -Headers $headers `
            -TimeoutSec $script:BloomRequestTimeoutSeconds
    }
    catch {
        return "Bloom scanner lookup failed: $($_.Exception.Message)"
    }
    # PowerShell may return the JSON array wrapped or unrolled; count rows that have an id.
    $found = @($response | ForEach-Object { $_ } | Where-Object { $null -ne $_ -and $null -ne $_.id })
    if ($found.Count -eq 0) { return "Scanner '$ScannerName' is not registered in Bloom." }
    $null
}

function Get-DatabaseRowCounts {
    <# Row count of every table in bloom.db, via deploy/windows/db-tool.js; empty if no database. #>
    param(
        [Parameter(Mandatory)][string]$DatabasePath,
        [Parameter(Mandatory)][string]$ToolsDir
    )
    if (-not (Test-Path -LiteralPath $DatabasePath)) { return @{} }
    $tool = Join-Path $PSScriptRoot 'db-tool.js'
    $env:NODE_PATH = Join-Path $ToolsDir 'node_modules'
    $output = @(Invoke-Node -Arguments @($tool, 'counts', $DatabasePath))
    if ($LASTEXITCODE -ne 0) { throw "Counting rows in $DatabasePath failed: $($output -join ' ')" }
    $counts = @{}
    ($output[-1] | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $counts[$_.Name] = [long]$_.Value }
    $counts
}

function Compare-RowCounts {
    <# Problems for any table that lost rows or disappeared; new tables are fine. #>
    param([Parameter(Mandatory)][hashtable]$Before, [Parameter(Mandatory)][hashtable]$After)
    foreach ($table in $Before.Keys | Sort-Object) {
        if (-not $After.ContainsKey($table)) { "Table $table is missing after the database upgrade." }
        elseif ($After[$table] -lt $Before[$table]) {
            "Table $table had $($Before[$table]) rows before the upgrade and $($After[$table]) after."
        }
    }
}

function Update-StationDatabase {
    <# Apply the release's Prisma migrations to bloom.db (creating it on a first install). #>
    param(
        [Parameter(Mandatory)][string]$DatabasePath,
        [Parameter(Mandatory)][string]$SchemaPath,
        [Parameter(Mandatory)][string]$ToolsDir
    )
    $prisma = Join-Path $ToolsDir 'node_modules\prisma\build\index.js'
    $previous = $env:BLOOM_DATABASE_URL
    $env:BLOOM_DATABASE_URL = 'file:' + ($DatabasePath -replace '\\', '/')
    try {
        $output = @(Invoke-Node -Arguments @($prisma, 'migrate', 'deploy', '--schema', $SchemaPath))
        $output | ForEach-Object { Write-DeployLog "  prisma: $_" }
        if ($LASTEXITCODE -ne 0) { throw "Database upgrade failed (prisma migrate deploy exited $LASTEXITCODE)." }
    }
    finally {
        $env:BLOOM_DATABASE_URL = $previous
    }
}

function Restore-StationData {
    <# Put back bloom.db and .env from a backup folder made by Backup-StationData. #>
    param([Parameter(Mandatory)][string]$BackupDir, [Parameter(Mandatory)][string]$ProfileDir)
    $targets = @{ 'bloom.db' = (Join-Path $ProfileDir '.bloom\data\bloom.db'); '.env' = (Join-Path $ProfileDir '.bloom\.env') }
    foreach ($name in $targets.Keys) {
        $saved = Join-Path $BackupDir $name
        if (Test-Path -LiteralPath $saved) {
            Copy-Item -LiteralPath $saved -Destination $targets[$name] -Force
            Write-DeployLog "Restored $($targets[$name]) from the backup."
        }
    }
}

function Invoke-DeploySelfTest {
    <#
      Run the installed app's --deploy-self-test on a copy of bloom.db: it uploads a
      3-frame synthetic scan to Bloom (experiment DEPLOY-TEST <scanner>). Returns
      Status (passed | failed | not-supported), Detail and Problems.
    #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$LocalAppData,
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$Species,
        [Parameter(Mandatory)][string]$WorkDir
    )
    if ([version]$Version -lt $script:SelfTestMinVersion) {
        return [pscustomobject]@{ Status = 'not-supported'; Detail = "v$Version has no self-test (added in $($script:SelfTestMinVersion))"; Problems = @() }
    }
    # The versioned exe, not the Squirrel launcher in the folder above, which exits at once.
    $exe = Join-Path $LocalAppData "bloom_desktop\app-$Version\Bloom Desktop.exe"
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $copy = Join-Path $WorkDir 'self-test-copy.db'
    $resultFile = Join-Path $WorkDir 'self-test-result.json'
    Remove-Item -LiteralPath $copy, $resultFile -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath (Join-Path $ProfileDir '.bloom\data\bloom.db') -Destination $copy

    try {
        $arguments = @('--deploy-self-test', "--database=`"$copy`"", "--species=`"$Species`"", "--result-file=`"$resultFile`"")
        $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru
        $null = $process.Handle
        if (-not $process.WaitForExit($script:SelfTestTimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            return [pscustomobject]@{ Status = 'failed'; Detail = 'timed out'; Problems = @("Self-test did not finish within $($script:SelfTestTimeoutSeconds) seconds.") }
        }
        if (-not (Test-Path -LiteralPath $resultFile)) {
            return [pscustomobject]@{ Status = 'failed'; Detail = "exit code $($process.ExitCode)"; Problems = @("Self-test wrote no result (exit code $($process.ExitCode)).") }
        }
        $result = Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json
        if ($result.ok) {
            return [pscustomobject]@{ Status = 'passed'; Detail = "uploaded $($result.uploaded) frames as plant $($result.plantId)"; Problems = @() }
        }
        $errors = @($result.errors) -join '; '
        [pscustomobject]@{ Status = 'failed'; Detail = "plant $($result.plantId)"; Problems = @("Self-test upload failed: $errors") }
    }
    finally {
        Remove-Item -LiteralPath $copy -Force -ErrorAction SilentlyContinue
    }
}

Export-ModuleMember -Function Set-DeployLogFile, Write-DeployLog, Read-StationEnv, Test-CameraReachable, Test-BloomAccess, Get-DatabaseRowCounts,
    Compare-RowCounts, Update-StationDatabase, Restore-StationData, Invoke-DeploySelfTest
