# Disk watchdog for the Windows E2E jobs in pr-checks.yml.
#
# Some Windows E2E shards fill the runner's C: drive mid-run. The runner then can't
# write its own log, so the job dies with no log at all. This script runs in the
# background during the tests: it records C: free space every few seconds, and when
# it drops below a limit it records the biggest folders and stops the tests, so the
# job ends normally and its log (with this report) is kept.
#
#   pwsh -File scripts/ci-disk-watchdog.ps1 -LogFile <path>

param(
    [Parameter(Mandatory)][string]$LogFile,
    [double]$StopBelowGB = 5,
    [int]$IntervalSeconds = 20
)

$ErrorActionPreference = 'Continue'

function Get-FreeGB { [math]::Round((Get-PSDrive -Name C).Free / 1GB, 1) }

function Get-FolderMB {
    param([string]$Path)
    $bytes = (Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    [math]::Round($bytes / 1MB)
}

function Write-BiggestFolders {
    # Where test runs write on C:: the profile (AppData, ~/.bloom), temp and crash reports.
    $roots = @(
        $env:USERPROFILE,
        (Join-Path $env:USERPROFILE 'AppData\Local'),
        (Join-Path $env:USERPROFILE 'AppData\Roaming'),
        $env:TEMP,
        'C:\ProgramData\Microsoft\Windows\WER',
        'C:\Windows\Temp'
    ) | Select-Object -Unique
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Add-Content -Path $LogFile -Value "Biggest folders in ${root}:"
        Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction SilentlyContinue |
            ForEach-Object { [pscustomobject]@{ MB = Get-FolderMB $_.FullName; Folder = $_.Name } } |
            Sort-Object MB -Descending | Select-Object -First 8 |
            ForEach-Object { Add-Content -Path $LogFile -Value ('  {0,8} MB  {1}' -f $_.MB, $_.Folder) }
    }
}

Add-Content -Path $LogFile -Value "$(Get-Date -Format HH:mm:ss)  watchdog started, C: free $(Get-FreeGB) GB"
while ($true) {
    Start-Sleep -Seconds $IntervalSeconds
    $free = Get-FreeGB
    Add-Content -Path $LogFile -Value "$(Get-Date -Format HH:mm:ss)  C: free $free GB"
    if ($free -lt $StopBelowGB) {
        Add-Content -Path $LogFile -Value "C: is nearly full ($free GB): stopping the tests so the job keeps its log."
        Write-BiggestFolders
        Get-Process -Name 'electron', 'Bloom Desktop', 'bloom-hardware', 'node' -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
        break
    }
}
