# StationChecks.psm1: what BloomDeploy.psm1 and StationData.psm1 share on a Windows
# CylinderScan station: the deploy log (with station details redacted), version helpers,
# reading .env, the checks before anything changes (settings, camera, Bloom access), the
# database row counts and upgrade. The upload self-test is in SelfTest.psm1.
#
# Secrets from .env (Bloom password, anon key) are only sent to the station's own Bloom
# URL. The log and the job summary are public, so Protect-DeployText replaces the station's
# paths, account, camera address and Bloom details in everything written to them.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

$script:CameraPingCount = 2
$script:BloomRequestTimeoutSeconds = 30
# Below this, the scans drive's health line warns; it never stops a deploy.
$script:MinScansDiskGB = 20
# Room for two releases' installers (about 0.7 GB each) and a backup of bloom.db.
$script:MinDeployDiskGB = 5
$script:MockVariables = @('BLOOM_USE_MOCK_HARDWARE', 'BLOOM_USE_MOCK_CAMERA', 'BLOOM_USE_MOCK_DAQ')
# The log file path is kept in the process environment, not module state, so every module
# that imports this one (BloomDeploy, StationData) writes to the same file.
$script:LogFileVariable = 'BLOOM_DEPLOY_LOG_FILE'
# Values shorter than this are left alone, so redaction can't mangle ordinary words.
$script:MinRedactedLength = 3
# Settings that aren't station details (the app's mock camera, a local address) are left
# alone, so a message like "CAMERA_IP_ADDRESS is mock" stays readable.
$script:NotRedacted = @('mock', 'localhost', '127.0.0.1')
# Set by Set-DeployRedactions from .env; the paths and account are read when used. Module
# state: every caller must share this one instance, so StationData.psm1 and
# deploy-station.ps1 import this module without -Force (BloomDeploy.psm1 loads it first).
$script:StationRedactions = @{}

function Set-DeployLogFile {
    param([string]$Path)
    [Environment]::SetEnvironmentVariable($script:LogFileVariable, $Path, 'Process')
}

function Set-DeployRedactions {
    <# Remember the camera address and Bloom details from .env, to keep them out of the log. #>
    param([Parameter(Mandatory)][hashtable]$Settings)
    $script:StationRedactions = @{}
    foreach ($key in 'CAMERA_IP_ADDRESS', 'BLOOM_SCANNER_USERNAME', 'BLOOM_SCANNER_PASSWORD', 'BLOOM_ANON_KEY') {
        $value = $Settings[$key]
        if ($value -and $script:NotRedacted -notcontains $value.Trim()) { $script:StationRedactions[$value] = "<$key>" }
    }
    $apiUrl = $null
    if ($Settings['BLOOM_API_URL'] -and [uri]::TryCreate($Settings['BLOOM_API_URL'], 'Absolute', [ref]$apiUrl)) {
        $script:StationRedactions[$apiUrl.Host] = '<Bloom host>'
    }
}

function Protect-DeployText {
    <# $Text with the station's paths, account and .env details replaced, for the public log. #>
    param([AllowEmptyString()][string]$Text)
    if (-not $Text) { return $Text }
    $replacements = @{}
    foreach ($key in $script:StationRedactions.Keys) { $replacements[$key] = $script:StationRedactions[$key] }
    # LOCALAPPDATA is inside USERPROFILE; longest values are replaced first.
    foreach ($name in 'LOCALAPPDATA', 'USERPROFILE') {
        $path = [Environment]::GetEnvironmentVariable($name)
        if ($path) { $replacements[$path] = "%$name%"; $replacements[$path -replace '\\', '/'] = "%$name%" }
    }
    foreach ($value in $replacements.Keys | Sort-Object -Property Length -Descending) {
        if ($value.Length -lt $script:MinRedactedLength) { continue }
        $Text = [regex]::Replace($Text, [regex]::Escape($value), $replacements[$value].Replace('$', '$$'), 'IgnoreCase')
    }
    # The account name only as a whole word or path part, so a name like "bloom" can't
    # mangle C:\BloomDeploy\... (the backup path an operator needs) or other words.
    if ($env:USERNAME -and $env:USERNAME.Length -ge $script:MinRedactedLength) {
        # Not followed by a word character, "-" or ".x" (so bloom.db is kept, "bloom." is not).
        $pattern = '(?<![\w.-])' + [regex]::Escape($env:USERNAME) + '(?![\w-]|\.\w)'
        $Text = [regex]::Replace($Text, $pattern, '<lab account>', 'IgnoreCase')
    }
    $Text
}

function Write-DeployLog {
    param([Parameter(Mandatory)][string]$Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Protect-DeployText -Text $Message)
    # Write-Host, not Write-Output, so log lines never mix into a function's return value.
    Write-Host $line
    $logFile = [Environment]::GetEnvironmentVariable($script:LogFileVariable, 'Process')
    # A log file that can't be written must never fail the deploy; the job log has the line.
    if ($logFile) { Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue }
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

# --- Versions: release form (tag) 0.2.1-rc.1, Squirrel folder form 0.2.1-rc1 -------------

function ConvertTo-SquirrelVersion {
    <# 0.2.1-rc.1 -> 0.2.1-rc1 (the Windows installer drops the dot); 0.2.1 is unchanged. #>
    param([Parameter(Mandatory)][string]$Version)
    $Version -replace '-([A-Za-z]+)\.(\d+)$', '-$1$2'
}

function ConvertFrom-SquirrelVersion {
    <# 0.2.1-rc1 -> 0.2.1-rc.1; 0.2.1 is unchanged. #>
    param([Parameter(Mandatory)][string]$Version)
    $Version -replace '-([A-Za-z]+)(\d+)$', '-$1.$2'
}

function Get-ReleaseBaseVersion {
    <# The X.Y.Z part of a release version, as [version]. #>
    param([Parameter(Mandatory)][string]$Version)
    [version](($Version -split '-', 2)[0])
}

function Sort-ReleaseVersions {
    <# Oldest first: 0.2.1-rc.1 < 0.2.1-rc.2 < 0.2.1 < 0.2.2. #>
    param([string[]]$Versions)
    $Versions | Sort-Object -Property `
        @{ Expression = { Get-ReleaseBaseVersion -Version $_ } },
        @{ Expression = { if ($_ -match '-') { 0 } else { 1 } } },
        @{ Expression = { if ($_ -match '-([A-Za-z]+)') { $Matches[1] } else { '' } } },
        @{ Expression = { if ($_ -match '-[A-Za-z]+\.(\d+)$') { [int]$Matches[1] } else { 0 } } }
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

function Get-UserEnvironmentVariable {
    param([Parameter(Mandatory)][string]$Name)
    [Environment]::GetEnvironmentVariable($Name, 'User')
}

function Get-FreeDiskGB {
    <# Free GB on $Path's drive root (Get-Item without -Force can't see hidden folders). Throws if it can't be read. #>
    param([Parameter(Mandatory)][string]$Path)
    $drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path)))
    # Checked first: PowerShell turns a property's exception into $null, which would read as 0 GB.
    if (-not $drive.IsReady) { throw "Drive $($drive.Name) doesn't exist or isn't ready." }
    [math]::Floor($drive.AvailableFreeSpace / 1GB)
}

function Get-ScansDriveHealth {
    <# Health only, never blocks a deploy: SCANS_DIR's free disk space, as a line for the job summary. #>
    param([Parameter(Mandatory)][string]$ProfileDir)
    $scansDir = (Read-StationEnv -ProfileDir $ProfileDir)['SCANS_DIR']
    if (-not $scansDir) { return 'not checked (no SCANS_DIR in .env)' }
    try { $free = Get-FreeDiskGB -Path $scansDir }
    catch { return "could not read: $($_.Exception.Message)" }
    if ($free -lt $script:MinScansDiskGB) { return "only $free GB of free disk space; scans may fail (at least $($script:MinScansDiskGB) GB recommended)" }
    "$free GB of free disk space"
}

function Test-StationReady {
    <#
      Station settings that don't depend on the release, checked before anything changes.
      Returns a list of problems; empty means the station is ready for a deploy.
    #>
    param(
        [Parameter(Mandatory)][string]$ScannerName,
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$DeployRoot
    )
    $problems = [System.Collections.Generic.List[string]]::new()

    foreach ($name in $script:MockVariables) {
        if ((Get-UserEnvironmentVariable -Name $name) -ne 'false') {
            $problems.Add("User environment variable $name must be 'false' so real hardware is used.")
        }
    }

    $settings = Read-StationEnv -ProfileDir $ProfileDir
    if ($settings.Count -eq 0) {
        $problems.Add('%USERPROFILE%\.bloom\.env is missing: set up Machine Configuration on the station.')
        return $problems.ToArray()
    }
    if ($settings['SCANNER_MODE'] -ne 'cylinderscan') { $problems.Add('SCANNER_MODE in .env must be cylinderscan.') }
    if ($settings['SCANNER_NAME'] -ne $ScannerName) {
        $problems.Add("SCANNER_NAME in .env is '$($settings['SCANNER_NAME'])', expected '$ScannerName'.")
    }
    $cameraIp = $settings['CAMERA_IP_ADDRESS']
    if (-not $cameraIp -or $cameraIp -eq 'mock') { $problems.Add('CAMERA_IP_ADDRESS in .env must be the real camera, not mock or empty.') }

    # Scans go to SCANS_DIR (e.g. E:\bloom-scans); installers and backups to the deploy folder.
    $scansDir = $settings['SCANS_DIR']
    if (-not $scansDir -or -not (Test-Path -LiteralPath $scansDir)) {
        $problems.Add("SCANS_DIR in .env must be a folder the deploy can see. It runs as the runner's service, so a drive mapped only in the signed-in session isn't visible to it.")
    }
    # Free disk space on the scans drive is a health check (Get-ScansDriveHealth), not a blocker.
    try {
        $deployFree = Get-FreeDiskGB -Path $DeployRoot
        if ($deployFree -lt $script:MinDeployDiskGB) {
            $problems.Add("Only $deployFree GB of free disk space for installers and backups; at least $($script:MinDeployDiskGB) GB is needed.")
        }
    }
    catch { $problems.Add("Could not read free disk space for installers and backups ($DeployRoot): $($_.Exception.Message)") }

    # Plain values, so callers' @(...) gives an empty array when there are no problems.
    $problems.ToArray()
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
        return "Bloom login with the station's saved account failed: $($_.Exception.Message)"
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
    $previousNodePath = $env:NODE_PATH
    $env:NODE_PATH = Join-Path $ToolsDir 'node_modules'
    try { $output = @(Invoke-Node -Arguments @($tool, 'counts', $DatabasePath)) }
    finally { $env:NODE_PATH = $previousNodePath }
    if ($LASTEXITCODE -ne 0) { throw "Counting rows in bloom.db failed: $($output -join ' ')" }
    # The JSON line; Node may also print warnings.
    $json = @($output | Where-Object { $_ -match '^\{' })
    if ($json.Count -eq 0) { throw 'Counting rows in bloom.db printed no result.' }
    $counts = @{}
    ($json[-1] | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $counts[$_.Name] = [long]$_.Value }
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
        # The public job log gets 'bloom.db', not the station's profile path.
        $paths = @($DatabasePath, ($DatabasePath -replace '\\', '/'))
        foreach ($line in $output) {
            foreach ($path in $paths) { $line = $line.Replace($path, 'bloom.db') }
            Write-DeployLog "  prisma: $line"
        }
        if ($LASTEXITCODE -ne 0) { throw "Database upgrade failed (prisma migrate deploy exited $LASTEXITCODE)." }
    }
    finally {
        $env:BLOOM_DATABASE_URL = $previous
    }
}

Export-ModuleMember -Function Set-DeployLogFile, Set-DeployRedactions, Protect-DeployText, Write-DeployLog, ConvertTo-SquirrelVersion, ConvertFrom-SquirrelVersion,
    Get-ReleaseBaseVersion, Sort-ReleaseVersions, Read-StationEnv, Get-UserEnvironmentVariable, Get-FreeDiskGB, Get-ScansDriveHealth, Test-StationReady, Test-CameraReachable, Test-BloomAccess, Get-DatabaseRowCounts,
    Compare-RowCounts, Update-StationDatabase
