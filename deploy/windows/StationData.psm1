# StationData.psm1: the station's data during a deploy: backing up bloom.db and .env
# before anything changes, keeping the database a failed deploy left behind, and putting
# the backup back. Every copy is checked against its source by SHA-256.
#
# SQLite may leave bloom.db-journal (or -wal/-shm) next to the database after a crash or
# an interrupted upgrade. They belong to the database: they are copied with it, and stale
# ones are removed before a restore so SQLite can't replay them onto the restored file.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1')

$script:BackupsKept = 5
$script:FailedCopiesKept = 5
$script:DatabaseSideFiles = @('-journal', '-wal', '-shm')

function Get-StationDataPaths {
    param([Parameter(Mandatory)][string]$ProfileDir)
    [pscustomobject]@{
        Database = Join-Path $ProfileDir '.bloom\data\bloom.db'
        Env      = Join-Path $ProfileDir '.bloom\.env'
    }
}

function Copy-VerifiedFile {
    <# Copy $Source to $Destination and throw unless the copy's hash matches. #>
    param([Parameter(Mandatory)][string]$Source, [Parameter(Mandatory)][string]$Destination)
    Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
    $expected = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ne $expected) {
        throw "The copy of $Source at $Destination does not match the original."
    }
}

function Copy-DatabaseWithSideFiles {
    <# Copy bloom.db and any journal/WAL files next to it into $DestDir. #>
    param([Parameter(Mandatory)][string]$DatabasePath, [Parameter(Mandatory)][string]$DestDir)
    foreach ($suffix in @('') + $script:DatabaseSideFiles) {
        $source = "$DatabasePath$suffix"
        if (Test-Path -LiteralPath $source) {
            Copy-VerifiedFile -Source $source -Destination (Join-Path $DestDir (Split-Path -Leaf $source))
        }
    }
}

function Backup-StationData {
    <#
      Copy bloom.db (with any journal files) and .env into a new timestamped folder,
      checking each copy. Returns the folder. Missing files (a first install) are noted.
    #>
    param(
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$BackupRoot,
        [string]$OldVersion
    )
    $label = if ($OldVersion) { "v$OldVersion" } else { 'none' }
    $dest = Join-Path $BackupRoot ('{0}_{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $label)
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $paths = Get-StationDataPaths -ProfileDir $ProfileDir

    if (Test-Path -LiteralPath $paths.Database) {
        Copy-DatabaseWithSideFiles -DatabasePath $paths.Database -DestDir $dest
        Write-DeployLog 'Backup: copied bloom.db.'
    }
    else { Write-DeployLog 'Backup: no bloom.db yet, nothing to copy.' }
    if (Test-Path -LiteralPath $paths.Env) {
        Copy-VerifiedFile -Source $paths.Env -Destination (Join-Path $dest '.env')
        Write-DeployLog 'Backup: copied .env.'
    }
    else { Write-DeployLog 'Backup: no .env yet, nothing to copy.' }
    $dest
}

function Remove-OldBackups {
    <#
      Keep the newest $Keep folders in $BackupRoot; never removes $Protect. Housekeeping
      only: a folder that can't be removed (e.g. open in another program) is logged and
      left, and never fails the deploy.
    #>
    param(
        [Parameter(Mandatory)][string]$BackupRoot,
        [int]$Keep = $script:BackupsKept,
        [string]$Protect
    )
    if (-not (Test-Path -LiteralPath $BackupRoot)) { return }
    $old = @(Get-ChildItem -LiteralPath $BackupRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -Skip $Keep)
    foreach ($dir in $old) {
        if ($Protect -and ($dir.FullName -eq $Protect)) { continue }
        try {
            Remove-Item -LiteralPath $dir.FullName -Recurse -Force -ErrorAction Stop
            Write-DeployLog "Removed old copy $($dir.Name)"
        }
        catch { Write-DeployLog "Could not remove old copy $($dir.Name): $($_.Exception.Message)" }
    }
}

function Save-FailedDatabase {
    <#
      Keep the database a failed deploy left behind (e.g. half upgraded) in its own
      timestamped folder under $FailedRoot, so it can be examined. Returns the folder,
      or $null when there is no database. Keeps the newest few.
    #>
    param(
        [Parameter(Mandatory)][string]$ProfileDir,
        [Parameter(Mandatory)][string]$FailedRoot,
        [Parameter(Mandatory)][string]$Version
    )
    $database = (Get-StationDataPaths -ProfileDir $ProfileDir).Database
    if (-not (Test-Path -LiteralPath $database)) { return $null }
    $dest = Join-Path $FailedRoot ('{0}_v{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Version)
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-DatabaseWithSideFiles -DatabasePath $database -DestDir $dest
    Remove-OldBackups -BackupRoot $FailedRoot -Keep $script:FailedCopiesKept -Protect $dest
    Write-DeployLog "Kept the failed deploy's database in $dest."
    $dest
}

function Restore-StationData {
    <#
      Put bloom.db and .env back from a Backup-StationData folder. Stale journal files go
      first and the backup's own come back last, after bloom.db is restored and checked, so
      an old journal is never left next to the upgraded database. Throws if a restored
      file doesn't match the backup.
    #>
    param([Parameter(Mandatory)][string]$BackupDir, [Parameter(Mandatory)][string]$ProfileDir)
    $paths = Get-StationDataPaths -ProfileDir $ProfileDir
    $savedDb = Join-Path $BackupDir 'bloom.db'
    if (Test-Path -LiteralPath $savedDb) {
        foreach ($suffix in $script:DatabaseSideFiles) {
            $stale = "$($paths.Database)$suffix"
            if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force -ErrorAction Stop }
        }
        Copy-VerifiedFile -Source $savedDb -Destination $paths.Database
        foreach ($suffix in $script:DatabaseSideFiles) {
            $savedSide = Join-Path $BackupDir "bloom.db$suffix"
            if (Test-Path -LiteralPath $savedSide) { Copy-VerifiedFile -Source $savedSide -Destination "$($paths.Database)$suffix" }
        }
        Write-DeployLog 'Restored bloom.db from the backup.'
    }
    $savedEnv = Join-Path $BackupDir '.env'
    if (Test-Path -LiteralPath $savedEnv) {
        Copy-VerifiedFile -Source $savedEnv -Destination $paths.Env
        Write-DeployLog 'Restored .env from the backup.'
    }
}

Export-ModuleMember -Function Backup-StationData, Remove-OldBackups, Save-FailedDatabase, Restore-StationData
