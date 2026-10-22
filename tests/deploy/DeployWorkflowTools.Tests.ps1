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
    $shell = (Get-Process -Id $PID).Path

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
        # All three checks ran.
        ([regex]::Matches($result.Output, 'node-ran')).Count | Should -Be 2
    }

    It 'stops with the tool''s exit code when it fails, before the next check' {
        $result = Invoke-Step -Fakes @'
function npm { cmd /c "exit 0" }
function node { cmd /c "echo node-ran & exit 3" }
'@
        $result.ExitCode | Should -Be 3 -Because $result.Output
        $result.Output | Should -Match '::error title=Database tools - prisma::exited with code 3'
        ([regex]::Matches($result.Output, 'node-ran')).Count | Should -Be 1
    }
}
