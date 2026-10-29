# Pester 5 tests for deploy/windows/ReleaseInstall.psm1. Run on windows-latest in CI:
#   Invoke-Pester -Path tests/deploy
# Uses temp folders (TestDrive) and mocks for downloads, the installer and processes, so
# nothing touches a real station.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\ReleaseInstall.psm1') -Force

    # A staged release as Save-ReleaseFiles leaves it: manifest, SHA256SUMS and Setup.exe.
    function New-StagedRelease {
        param([Parameter(Mandatory)][string]$StageDir, [string]$Installer = 'installer')
        New-Item -ItemType Directory -Force -Path $StageDir | Out-Null
        Set-Content -LiteralPath (Join-Path $StageDir 'Setup.exe') -Value $Installer -NoNewline
        $hash = (Get-FileHash -LiteralPath (Join-Path $StageDir 'Setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath (Join-Path $StageDir 'SHA256SUMS') -Value "$hash  Setup.exe"
        Set-Content -LiteralPath (Join-Path $StageDir 'manifest.json') -Value '{"files": [{"name": "Setup.exe", "target": "windows"}, {"name": "bloom.deb", "target": "linux"}]}'
    }

    # An installed app-<version> folder, with the exe that makes it count as installed.
    function New-InstalledVersion {
        param([Parameter(Mandatory)][string]$LocalAppData, [Parameter(Mandatory)][string]$Folder)
        $dir = Join-Path $LocalAppData "bloom_desktop\app-$Folder"
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Set-Content -LiteralPath (Join-Path $dir 'Bloom Desktop.exe') -Value 'exe'
    }

    # What Start-Process returns, for an installer that exits with $ExitCode (or never, with -Hangs).
    function New-FakeProcess {
        param([int]$ExitCode = 0, [switch]$Hangs)
        $exited = -not $Hangs
        [pscustomobject]@{ Id = 42; Handle = 1; ExitCode = $ExitCode } |
            Add-Member -MemberType ScriptMethod -Name WaitForExit -Value ([scriptblock]::Create("param(`$ms) `$$exited")) -PassThru
    }
}

Describe 'Assert-Checksums' {
    BeforeEach {
        $stage = Join-Path $TestDrive 'stage'
        New-Item -ItemType Directory -Force -Path $stage | Out-Null
        Set-Content -LiteralPath (Join-Path $stage 'Setup.exe') -Value 'installer' -NoNewline
        $hash = (Get-FileHash -LiteralPath (Join-Path $stage 'Setup.exe') -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS') -Value "$hash  Setup.exe"
    }

    It 'passes when the file matches' {
        { Assert-Checksums -StageDir $stage -FileNames 'Setup.exe' } | Should -Not -Throw
    }

    It 'throws on a mismatch' {
        Set-Content -LiteralPath (Join-Path $stage 'Setup.exe') -Value 'tampered' -NoNewline
        { Assert-Checksums -StageDir $stage -FileNames 'Setup.exe' } | Should -Throw '*Checksum mismatch*'
    }

    It 'throws when a file is not listed' {
        Set-Content -LiteralPath (Join-Path $stage 'other.nupkg') -Value 'x'
        { Assert-Checksums -StageDir $stage -FileNames 'other.nupkg' } | Should -Throw '*not listed*'
    }
}

Describe 'Save-ReleaseFiles' {
    BeforeEach {
        # The "release": files served by the mocked download, from a folder of fixtures.
        $published = Join-Path $TestDrive ('published-' + [guid]::NewGuid())
        New-StagedRelease -StageDir $published
        $stage = Join-Path $TestDrive ('stage-' + [guid]::NewGuid())
        Mock -ModuleName ReleaseInstall Invoke-WebRequest {
            Copy-Item -LiteralPath (Join-Path $published ($Uri -replace '^.*/', '')) -Destination $OutFile
        }
    }

    It 'downloads the Windows files, checks them and returns Setup.exe' {
        Save-ReleaseFiles -BaseUrl 'https://example.invalid/download/v0.2.1' -StageDir $stage |
            Should -Be (Join-Path $stage 'Setup.exe')
        Should -Invoke -ModuleName ReleaseInstall Invoke-WebRequest -Times 0 -Exactly -ParameterFilter { $Uri -like '*bloom.deb' }
    }

    It 'throws on a tampered installer' {
        Set-Content -LiteralPath (Join-Path $published 'Setup.exe') -Value 'tampered' -NoNewline
        { Save-ReleaseFiles -BaseUrl 'https://example.invalid/download/v0.2.1' -StageDir $stage } |
            Should -Throw '*Checksum mismatch*'
    }

    It 'throws when the release has no Windows files' {
        Set-Content -LiteralPath (Join-Path $published 'manifest.json') -Value '{"files": [{"name": "bloom.deb", "target": "linux"}]}'
        { Save-ReleaseFiles -BaseUrl 'https://example.invalid/download/v0.2.1' -StageDir $stage } |
            Should -Throw '*no Windows files*'
    }
}

Describe 'Test-StagedRelease' {
    BeforeEach {
        $stage = Join-Path $TestDrive ('staged-' + [guid]::NewGuid())
        New-StagedRelease -StageDir $stage
    }

    It 'is true for a complete, matching release' {
        Test-StagedRelease -StageDir $stage | Should -BeTrue
    }

    It 'is false when a file was changed after staging' {
        Set-Content -LiteralPath (Join-Path $stage 'Setup.exe') -Value 'swapped' -NoNewline
        Test-StagedRelease -StageDir $stage | Should -BeFalse
    }

    It 'is false without the manifest' {
        Remove-Item -LiteralPath (Join-Path $stage 'manifest.json')
        Test-StagedRelease -StageDir $stage | Should -BeFalse
    }
}

Describe 'Invoke-Rollback' {
    BeforeEach {
        $releases = Join-Path $TestDrive ('releases-' + [guid]::NewGuid())
        $lad = Join-Path $TestDrive ('lad-' + [guid]::NewGuid())
        New-StagedRelease -StageDir (Join-Path $releases 'v0.1.0')
        New-InstalledVersion -LocalAppData $lad -Folder '0.2.0'
        Mock -ModuleName ReleaseInstall Stop-InstallerProcesses { }
    }

    It 'refuses to run a staged installer that does not match SHA256SUMS' {
        Set-Content -LiteralPath (Join-Path $releases 'v0.1.0\Setup.exe') -Value 'swapped' -NoNewline
        Mock -ModuleName ReleaseInstall Install-Release { }
        { Invoke-Rollback -PreviousVersion '0.1.0' -ReleasesRoot $releases -LocalAppData $lad } |
            Should -Throw "*don't match SHA256SUMS*"
        Should -Invoke -ModuleName ReleaseInstall Install-Release -Times 0 -Exactly
    }

    It 'runs the previous Setup.exe over the newer version, without uninstalling' {
        Mock -ModuleName ReleaseInstall Install-Release { }
        Mock -ModuleName ReleaseInstall Start-Process { }
        Invoke-Rollback -PreviousVersion '0.1.0' -ReleasesRoot $releases -LocalAppData $lad
        Should -Invoke -ModuleName ReleaseInstall Install-Release -Times 1 -Exactly -ParameterFilter { $SetupExe -eq (Join-Path $releases 'v0.1.0\Setup.exe') }
        Should -Invoke -ModuleName ReleaseInstall Start-Process -Times 0 -Exactly
        Test-Path -LiteralPath (Join-Path $lad 'bloom_desktop') | Should -BeTrue
    }

    It 'removes the app folder and tries once more when the reinstall fails' {
        $script:installs = 0
        Mock -ModuleName ReleaseInstall Install-Release { $script:installs++; if ($script:installs -eq 1) { throw 'Setup.exe exited with code 1.' } }
        Invoke-Rollback -PreviousVersion '0.1.0' -ReleasesRoot $releases -LocalAppData $lad
        $script:installs | Should -Be 2
        Test-Path -LiteralPath (Join-Path $lad 'bloom_desktop') | Should -BeFalse
    }

    It 'throws when the second try fails too' {
        Mock -ModuleName ReleaseInstall Install-Release { throw 'Setup.exe exited with code 1.' }
        { Invoke-Rollback -PreviousVersion '0.1.0' -ReleasesRoot $releases -LocalAppData $lad } | Should -Throw '*exited with code 1*'
        Should -Invoke -ModuleName ReleaseInstall Install-Release -Times 2 -Exactly
    }
}

Describe 'Get-InstalledVersion' {
    It 'returns $null when the app is not installed' {
        Get-InstalledVersion -LocalAppData (Join-Path $TestDrive 'empty') | Should -BeNullOrEmpty
    }

    It 'returns the newest version, mapping pre-release folders to release versions' {
        $lad = Join-Path $TestDrive 'lad-rc'
        foreach ($v in '0.2.0', '0.2.1-rc1', '0.2.1-rc2') { New-InstalledVersion -LocalAppData $lad -Folder $v }
        Get-InstalledVersion -LocalAppData $lad | Should -Be '0.2.1-rc.2'
        New-InstalledVersion -LocalAppData $lad -Folder '0.2.1'
        Get-InstalledVersion -LocalAppData $lad | Should -Be '0.2.1'
    }

    It 'returns the highest app-<version> folder' {
        $lad = Join-Path $TestDrive 'lad'
        foreach ($v in '0.1.9', '0.2.0', '0.10.0') { New-InstalledVersion -LocalAppData $lad -Folder $v }
        Get-InstalledVersion -LocalAppData $lad | Should -Be '0.10.0'
    }

    It 'ignores a folder without the app in it, as a half-finished install or removal leaves' {
        $lad = Join-Path $TestDrive 'lad-partial'
        New-InstalledVersion -LocalAppData $lad -Folder '0.2.0'
        New-Item -ItemType Directory -Force -Path (Join-Path $lad 'bloom_desktop\app-0.2.1') | Out-Null
        Get-InstalledVersion -LocalAppData $lad | Should -Be '0.2.0'
    }
}

Describe 'Test-Installation' {
    BeforeEach {
        $lad = Join-Path $TestDrive ('lad-' + [guid]::NewGuid())
        New-InstalledVersion -LocalAppData $lad -Folder '0.2.0'
    }

    It 'reports no problems when the requested version is installed' {
        @(Test-Installation -Version '0.2.0' -LocalAppData $lad) | Should -HaveCount 0
    }

    It 'reports the wrong installed version' {
        @(Test-Installation -Version '0.3.0' -LocalAppData $lad) | Should -Contain "Installed version is '0.2.0', expected '0.3.0'."
    }
}

Describe 'Install-Release' {
    BeforeEach {
        $lad = Join-Path $TestDrive ('lad-' + [guid]::NewGuid())
        $squirrelLog = Join-Path $lad 'SquirrelTemp\Squirrel-Install.log'
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $squirrelLog) | Out-Null
        Set-Content -LiteralPath $squirrelLog -Value 'an earlier install'
        $stagedReleases = Join-Path $TestDrive 'releases'
        $setup = Join-Path (Join-Path $stagedReleases 'v0.2.1') 'Setup.exe'
        Mock -ModuleName ReleaseInstall Stop-InstallerProcesses { }
        Mock -ModuleName ReleaseInstall Stop-Process { }
        $script:logged = [System.Collections.Generic.List[string]]::new()
        Mock -ModuleName ReleaseInstall Write-DeployLog { $script:logged.Add($Message) }
    }

    It 'sets the skip-first-run variable for the installer and restores it afterwards' {
        $script:seen = $null
        Mock -ModuleName ReleaseInstall Start-Process {
            $script:seen = [Environment]::GetEnvironmentVariable('BLOOM_DEPLOY_SKIP_FIRSTRUN', 'Process')
            New-FakeProcess
        }
        Install-Release -SetupExe $setup -LocalAppData $lad
        $script:seen | Should -Be '1'
        [Environment]::GetEnvironmentVariable('BLOOM_DEPLOY_SKIP_FIRSTRUN', 'Process') | Should -BeNullOrEmpty
    }

    It 'throws when the installer fails' {
        Mock -ModuleName ReleaseInstall Start-Process { New-FakeProcess -ExitCode 3 }
        { Install-Release -SetupExe $setup -LocalAppData $lad } | Should -Throw '*exited with code 3*'
    }

    It 'copies only this install''s lines of the installer''s log into the deploy log' {
        Mock -ModuleName ReleaseInstall Start-Process {
            Add-Content -LiteralPath $squirrelLog -Value 'Install path already exists, burning it to the ground', 'Fatal error'
            New-FakeProcess -ExitCode 1
        }
        { Install-Release -SetupExe $setup -LocalAppData $lad } | Should -Throw
        $script:logged | Should -Contain '  installer: Install path already exists, burning it to the ground'
        $script:logged | Should -Contain '  installer: Fatal error'
        $script:logged | Should -Not -Contain '  installer: an earlier install'
    }

    It 'stops a hung installer at the time limit' {
        Mock -ModuleName ReleaseInstall Wait-ProcessWithProgress { $false }
        Mock -ModuleName ReleaseInstall Start-Process { New-FakeProcess -Hangs }
        { Install-Release -SetupExe $setup -LocalAppData $lad } | Should -Throw '*did not finish*was stopped*'
        Should -Invoke -ModuleName ReleaseInstall Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -eq 42 }
        # Once before starting (leftovers from an earlier deploy), once after the time limit.
        Should -Invoke -ModuleName ReleaseInstall Stop-InstallerProcesses -Times 2 -Exactly -ParameterFilter { $ReleasesRoot -eq $stagedReleases }
    }
}

Describe 'Stop-InstallerProcesses' {
    BeforeEach {
        Mock -ModuleName ReleaseInstall Stop-Process { }
        Mock -ModuleName ReleaseInstall Wait-Process { }
        Mock -ModuleName ReleaseInstall Write-DeployLog { }
    }

    It 'stops only installers run from the app folder, Squirrel''s temp folder or the staged releases' {
        Mock -ModuleName ReleaseInstall Get-CimInstance {
            [pscustomobject]@{ ProcessId = 1; ExecutablePath = 'C:\lad\bloom_desktop\Update.exe' }
            [pscustomobject]@{ ProcessId = 2; ExecutablePath = 'C:\BloomDeploy\releases\v0.2.0\Bloom-Desktop-0.2.0-Setup.exe' }
            [pscustomobject]@{ ProcessId = 3; ExecutablePath = 'C:\lad\OtherApp\Update.exe' }
            [pscustomobject]@{ ProcessId = 4; ExecutablePath = $null }
        }
        Stop-InstallerProcesses -LocalAppData 'C:\lad' -ReleasesRoot 'C:\BloomDeploy\releases'
        Should -Invoke -ModuleName ReleaseInstall Stop-Process -Times 2 -Exactly
        Should -Invoke -ModuleName ReleaseInstall Stop-Process -Times 0 -Exactly -ParameterFilter { $Id -in 3, 4 }
    }

    It 'does nothing when no installer is running' {
        Mock -ModuleName ReleaseInstall Get-CimInstance { }
        Stop-InstallerProcesses -LocalAppData 'C:\lad'
        Should -Invoke -ModuleName ReleaseInstall Stop-Process -Times 0 -Exactly
    }
}
