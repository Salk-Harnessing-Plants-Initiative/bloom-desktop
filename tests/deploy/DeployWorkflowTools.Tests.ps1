# Pester 5 tests for the "Install and check the database tools" step of
# .github/workflows/deploy.yml. npm and prisma print warnings on stderr, which must not
# stop the deploy under the runner's $ErrorActionPreference = 'stop', while a tool that
# fails (non-zero exit code) must stop it with that code. The step's own script is taken
# from the workflow and run in a separate PowerShell, as the runner runs it, with fake
# npm and node commands.

BeforeAll {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $workflow = Get-Content -Raw (Join-Path $repoRoot '.github\workflows\deploy.yml')
    # The step's script: from its error-preference line to the next step.
    $match = [regex]::Match($workflow, "(?s)( {10}\`$ErrorActionPreference = 'Continue'.*?)\r?\n\r?\n {6}- name: Install the release")
    $stepScript = ($match.Groups[1].Value -split "\r?\n" | ForEach-Object { $_ -replace '^ {10}', '' }) -join "`n"
    # The workflow runs the step with Windows PowerShell 5.1 (`shell: powershell`), so both
    # CI legs (powershell and pwsh) run it with that, not with the shell running Pester.
    $shell = (Get-Command powershell.exe).Source

    function Invoke-Step {
        <# Run the step with fake npm/node (functions win over programs); returns exit code and output. #>
        param([string]$Fakes)
        $runnerTemp = Join-Path $TestDrive ('runner-temp-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force $runnerTemp | Out-Null
        $file = Join-Path $TestDrive ('step-' + [guid]::NewGuid() + '.ps1')
        # The runner puts this first in every `shell: powershell` step.
        Set-Content -LiteralPath $file -Value ("`$ErrorActionPreference = 'stop'`n" + $Fakes + "`n" + $stepScript)
        $saved = $env:RUNNER_TEMP
        $env:RUNNER_TEMP = $runnerTemp
        $ErrorActionPreference = 'Continue'
        try {
            $output = & $shell -NoProfile -NonInteractive -Command "Set-Location '$repoRoot'; . '$file'" 2>&1
            [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
        }
        finally { $env:RUNNER_TEMP = $saved }
    }
}

Describe 'deploy.yml database tools step' {
    It 'finds the step''s script' {
        $match.Success | Should -BeTrue
        $stepScript | Should -Match 'function Invoke-Tool'
    }

    It 'carries on after warnings on stderr and shows them as warning annotations' {
        $result = Invoke-Step -Fakes @'
function npm { cmd /c "echo npm warn deprecated prebuild-install 1>&2 & exit 0" }
function node { cmd /c "echo warn prisma config is deprecated 1>&2 & echo node-ran %* & exit 0" }
'@
        $result.ExitCode | Should -Be 0 -Because $result.Output
        $result.Output | Should -Match '::warning title=Database tools - npm ci::npm warn deprecated prebuild-install'
        $result.Output | Should -Match '::warning title=Database tools - prisma::warn prisma config is deprecated'
        # Both node checks ran (after npm ci).
        ([regex]::Matches($result.Output, 'node-ran')).Count | Should -Be 2
    }

    It 'fails the step when a tool fails, with its exit code on the run, before the next check' {
        $result = Invoke-Step -Fakes @'
function npm { cmd /c "exit 0" }
function node { cmd /c "echo node-ran & exit 3" }
'@
        # Non-zero fails the step. Through `powershell -Command` (as the runner runs steps)
        # Windows PowerShell reports any `exit N` from the script as 1, so the tool's own
        # code is checked in the annotation instead.
        $result.ExitCode | Should -Not -Be 0 -Because $result.Output
        $result.Output | Should -Match '::error title=Database tools - prisma::exited with code 3'
        ([regex]::Matches($result.Output, 'node-ran')).Count | Should -Be 1
    }

    It 'stops before the other checks when npm ci fails' {
        $result = Invoke-Step -Fakes @'
function npm { cmd /c "exit 2" }
function node { cmd /c "echo node-ran & exit 0" }
'@
        $result.ExitCode | Should -Not -Be 0 -Because $result.Output
        $result.Output | Should -Match '::error title=Database tools - npm ci::exited with code 2'
        ([regex]::Matches($result.Output, 'node-ran')).Count | Should -Be 0
    }

    It 'treats a command that is not found as a failure' {
        $result = Invoke-Step -Fakes @'
function npm { cmd /c "exit 0" }
function node { Invoke-NoSuchToolForTheTest }
'@
        $result.ExitCode | Should -Not -Be 0 -Because $result.Output
        $result.Output | Should -Match '::error title=Database tools - prisma::exited with code 1'
    }
}
