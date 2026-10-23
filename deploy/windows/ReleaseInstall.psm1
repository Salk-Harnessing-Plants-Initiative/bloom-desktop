# ReleaseInstall.psm1: the release's files and installing them on a station. Downloading
# and checking a release against SHA256SUMS, finding the installed version, running
# Setup.exe, and reinstalling the previous version after a failed deploy.
#
# Squirrel's Setup.exe replaces whatever is installed ("Install path ... already exists,
# burning it to the ground"), newer or older, so a rollback just runs the previous
# version's Setup.exe. Uninstalling first is what broke PC1's first rollback: Update.exe
# --uninstall deletes the app folder in the background after it exits, and the next
# install collided with it. Squirrel's own log lines are copied into the deploy log.
#
# Works on Windows PowerShell 5.1 (built into the stations) and PowerShell 7.

Set-StrictMode -Version Latest

# Without -Force: reuse the instances BloomDeploy.psm1 loaded (log redactions, stages).
Import-Module (Join-Path $PSScriptRoot 'StationChecks.psm1')
Import-Module (Join-Path $PSScriptRoot 'DeployStages.psm1')

$script:InstallTimeoutSeconds = 600
$script:DownloadTimeoutSeconds = 600
# Leftover installer processes get this long to exit after being stopped.
$script:StopWaitSeconds = 15
$script:SquirrelAppFolder = 'bloom_desktop'
# The app quits on Squirrel's --squirrel-firstrun when this is set, so an install from
# the runner service doesn't start the app (and open the database) in a hidden session.
$script:SkipFirstRunVariable = 'BLOOM_DEPLOY_SKIP_FIRSTRUN'

function Get-FileSha256 {
    param([Parameter(Mandatory)][string]$Path)
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Save-ReleaseFiles {
    <#
      Download manifest.json, SHA256SUMS and the release's Windows files into $StageDir,
      logging each file's size and time, and check every Windows file against SHA256SUMS.
      Returns the Setup.exe path.
    #>
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$StageDir
    )
    New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
    foreach ($name in 'manifest.json', 'SHA256SUMS') {
        Invoke-WebRequest -Uri "$BaseUrl/$name" -OutFile (Join-Path $StageDir $name) `
            -UseBasicParsing -TimeoutSec $script:DownloadTimeoutSeconds
    }

    $manifest = Get-Content -Raw -LiteralPath (Join-Path $StageDir 'manifest.json') | ConvertFrom-Json
    $windowsFiles = @($manifest.files | Where-Object { $_.target -eq 'windows' })
    if ($windowsFiles.Count -eq 0) { throw 'The release has no Windows files.' }

    foreach ($file in $windowsFiles) {
        $size = if ($file.PSObject.Properties['size']) { ' ({0:N0} MB)' -f ($file.size / 1MB) } else { '' }
        Write-DeployLog "Downloading $($file.name)$size..."
        $started = Get-Date
        Invoke-WebRequest -Uri "$BaseUrl/$($file.name)" -OutFile (Join-Path $StageDir $file.name) `
            -UseBasicParsing -TimeoutSec $script:DownloadTimeoutSeconds
        Write-DeployLog ("  done in {0:N0} s." -f ((Get-Date) - $started).TotalSeconds)
    }
    Assert-Checksums -StageDir $StageDir -FileNames ($windowsFiles | ForEach-Object { $_.name })
    Write-DeployLog "Checksums match SHA256SUMS for $($windowsFiles.Count) file(s)."

    $setup = @($windowsFiles | Where-Object { $_.name -like '*.exe' })
    if ($setup.Count -ne 1) { throw "Expected one Setup.exe in the release, found $($setup.Count)." }
    Join-Path $StageDir $setup[0].name
}

function Test-StagedRelease {
    <# True when $StageDir holds a release's manifest, SHA256SUMS and Windows files, all matching. #>
    param([Parameter(Mandatory)][string]$StageDir)
    $manifestPath = Join-Path $StageDir 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath (Join-Path $StageDir 'SHA256SUMS'))) { return $false }
    $names = @((Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).files |
        Where-Object { $_.target -eq 'windows' } | ForEach-Object { $_.name })
    if ($names.Count -eq 0) { return $false }
    try { Assert-Checksums -StageDir $StageDir -FileNames $names; $true } catch { $false }
}

function Assert-Checksums {
    param(
        [Parameter(Mandatory)][string]$StageDir,
        [Parameter(Mandatory)][string[]]$FileNames
    )
    $expected = @{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $StageDir 'SHA256SUMS')) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') { $expected[$Matches[2]] = $Matches[1].ToLowerInvariant() }
    }
    foreach ($name in $FileNames) {
        if (-not $expected.ContainsKey($name)) { throw "$name is not listed in SHA256SUMS." }
        $actual = Get-FileSha256 -Path (Join-Path $StageDir $name)
        if ($actual -ne $expected[$name]) { throw "Checksum mismatch for ${name}: expected $($expected[$name]), got $actual." }
    }
}

function Get-InstalledVersion {
    <#
      Newest app-<version> folder under %LOCALAPPDATA%\bloom_desktop that holds the app, in
      release form (app-0.2.1-rc1 is 0.2.1-rc.1), or $null. A half-deleted folder without
      Bloom Desktop.exe doesn't count.
    #>
    param([Parameter(Mandatory)][string]$LocalAppData)
    $root = Join-Path $LocalAppData $script:SquirrelAppFolder
    if (-not (Test-Path -LiteralPath $root)) { return $null }
    $versions = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'Bloom Desktop.exe') } |
        ForEach-Object { $_.Name.Substring(4) } |
        Where-Object { $_ -match '^\d+\.\d+\.\d+(-[A-Za-z]+\d+)?$' } |
        ForEach-Object { ConvertFrom-SquirrelVersion -Version $_ })
    if ($versions.Count -eq 0) { return $null }
    @(Sort-ReleaseVersions -Versions $versions)[-1]
}

function Test-Installation {
    <# After installing: a list of problems; empty when $Version is the installed version. #>
    param(
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)][string]$LocalAppData
    )
    $installed = Get-InstalledVersion -LocalAppData $LocalAppData
    if ($installed -ne $Version) { return @("Installed version is '$installed', expected '$Version'.") }
    @()
}

function Stop-InstallerProcesses {
    <#
      Stop Squirrel processes (Setup.exe, Update.exe) left running from this user's installs
      or from the staged releases in $ReleasesRoot.
    #>
    param([Parameter(Mandatory)][string]$LocalAppData, [string]$ReleasesRoot)
    $roots = @((Join-Path $LocalAppData $script:SquirrelAppFolder), (Join-Path $LocalAppData 'SquirrelTemp')) + @($ReleasesRoot | Where-Object { $_ })
    $left = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'Update.exe' OR Name LIKE '%Setup.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $path = $_.ExecutablePath; $path -and @($roots | Where-Object { $path -like "$_\*" }).Count -gt 0 })
    if ($left.Count -eq 0) { return }
    Write-DeployLog "Stopping $($left.Count) leftover installer process(es)."
    foreach ($p in $left) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    Wait-Process -Id ($left | ForEach-Object { $_.ProcessId }) -Timeout $script:StopWaitSeconds -ErrorAction SilentlyContinue
}

function Write-InstallerLog {
    <# Copy what Squirrel added to its install log since $FromLength into the deploy log. #>
    param([Parameter(Mandatory)][string]$LogPath, [long]$FromLength = 0)
    if (-not (Test-Path -LiteralPath $LogPath)) { return }
    try {
        $stream = [IO.File]::Open($LogPath, 'Open', 'Read', 'ReadWrite')
        try {
            if ($FromLength -le $stream.Length) { $stream.Position = $FromLength }
            $text = (New-Object IO.StreamReader $stream).ReadToEnd()
        }
        finally { $stream.Dispose() }
        foreach ($line in ($text -split "\r?\n" | Where-Object { $_.Trim() })) { Write-DeployLog "  installer: $line" }
    }
    catch { Write-DeployLog "Couldn't read the installer's log: $($_.Exception.Message)" }
}

function Install-Release {
    <#
      Run Setup.exe silently, waiting (with progress) up to the time limit. A Setup.exe that
      fails shows an error dialog nobody can see under the runner service, so on timeout it
      and its Update.exe are stopped. Squirrel's log lines go into the deploy log either way.
    #>
    param(
        [Parameter(Mandatory)][string]$SetupExe,
        [string]$LocalAppData = $env:LOCALAPPDATA
    )
    $squirrelLog = Join-Path $LocalAppData 'SquirrelTemp\Squirrel-Install.log'
    $logStart = if (Test-Path -LiteralPath $squirrelLog) { (Get-Item -LiteralPath $squirrelLog).Length } else { 0 }
    # Setup.exe runs from the releases folder; a hung one from an earlier deploy blocks this one.
    $releasesRoot = Split-Path -Parent (Split-Path -Parent $SetupExe)
    Stop-InstallerProcesses -LocalAppData $LocalAppData -ReleasesRoot $releasesRoot
    $previous = [Environment]::GetEnvironmentVariable($script:SkipFirstRunVariable, 'Process')
    [Environment]::SetEnvironmentVariable($script:SkipFirstRunVariable, '1', 'Process')
    try {
        Write-DeployLog "Running $(Split-Path -Leaf $SetupExe) --silent."
        $process = Start-Process -FilePath $SetupExe -ArgumentList '--silent' -PassThru
        # Windows PowerShell only keeps ExitCode if the handle is read while the process runs.
        $null = $process.Handle
        if (-not (Wait-ProcessWithProgress -Process $process -TimeoutSeconds $script:InstallTimeoutSeconds -What 'the installer')) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            Stop-InstallerProcesses -LocalAppData $LocalAppData -ReleasesRoot $releasesRoot
            throw "Setup.exe did not finish within $($script:InstallTimeoutSeconds) seconds and was stopped; see the installer's log above."
        }
        if ($process.ExitCode -ne 0) { throw "Setup.exe exited with code $($process.ExitCode); see the installer's log above." }
    }
    finally {
        [Environment]::SetEnvironmentVariable($script:SkipFirstRunVariable, $previous, 'Process')
        Write-InstallerLog -LogPath $squirrelLog -FromLength $logStart
    }
}

function Invoke-Rollback {
    <#
      Reinstall $PreviousVersion from its staged, re-verified release by running its Setup.exe,
      which replaces the newer version (no uninstall first). If that fails, the app folder is
      removed (the station's data is elsewhere, in %USERPROFILE%\.bloom) and it's tried once more.
    #>
    param(
        [Parameter(Mandatory)][string]$PreviousVersion,
        [Parameter(Mandatory)][string]$ReleasesRoot,
        [Parameter(Mandatory)][string]$LocalAppData
    )
    $stage = Join-Path $ReleasesRoot "v$PreviousVersion"
    if (-not (Test-StagedRelease -StageDir $stage)) {
        throw "Can't roll back: the staged files for v$PreviousVersion in $stage are missing or don't match SHA256SUMS."
    }
    $setup = @(Get-ChildItem -LiteralPath $stage -Filter '*.exe' -ErrorAction SilentlyContinue)
    if ($setup.Count -ne 1) { throw "Can't roll back: no staged Setup.exe for v$PreviousVersion in $stage." }

    try { Install-Release -SetupExe $setup[0].FullName -LocalAppData $LocalAppData }
    catch {
        Write-DeployLog "Reinstalling v$PreviousVersion failed ($($_.Exception.Message)); removing the app folder and trying once more."
        Stop-InstallerProcesses -LocalAppData $LocalAppData -ReleasesRoot $ReleasesRoot
        Remove-Item -LiteralPath (Join-Path $LocalAppData $script:SquirrelAppFolder) -Recurse -Force -ErrorAction SilentlyContinue
        Install-Release -SetupExe $setup[0].FullName -LocalAppData $LocalAppData
    }
}

Export-ModuleMember -Function Save-ReleaseFiles, Test-StagedRelease, Assert-Checksums, Get-InstalledVersion,
    Test-Installation, Install-Release, Invoke-Rollback, Stop-InstallerProcesses
