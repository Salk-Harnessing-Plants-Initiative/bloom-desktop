# Pester 5 tests for the "Install and check the database tools" step of
# .github/workflows/deploy.yml: npm and prisma print warnings on stderr, which must not
# stop the deploy under the runner's $ErrorActionPreference = 'stop', while a real failure
# (a non-zero exit code) must. The step's own script is taken from the workflow and run
# in a separate PowerShell, as the runner runs it.

BeforeAll {
    $workflow = Get-Content -Raw (Join-Path $PSScriptRoot '..\..\.github\workflows\deploy.yml')
    # From the step's error-preference line to the end of its Invoke-Tool function.
    $match = [regex]::Match($workflow, "(?s)\`$ErrorActionPreference = 'Continue'.*?\r?\n {10}\}\r?\n")
    $preamble = ($match.Value -split "\r?\n" | ForEach-Object { $_ -replace '^ {10}', '' }) -join "`n"
    $shell = (Get-Process -Id $PID).Path

    function Invoke-StepScript {
        param([string]$Body)
        $file = Join-Path $TestDrive ('step-' + [guid]::NewGuid() + '.ps1')
        # The runner puts this first in every `shell: powershell` step.
        Set-Content -LiteralPath $file -Value ("`$ErrorActionPreference = 'stop'`n" + $preamble + "`n" + $Body)
        $ErrorActionPreference = 'Continue'
        $output = & $shell -NoProfile -NonInteractive -Command ". '$file'" 2>&1
        [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
    }
}

Describe 'deploy.yml database tools step' {
    It 'finds the step''s Invoke-Tool function' {
        $match.Success | Should -BeTrue
        $preamble | Should -Match 'function Invoke-Tool'
    }

    It 'carries on after a warning on stderr and shows it as a warning annotation' {
        $result = Invoke-StepScript -Body @'
Invoke-Tool 'Tools - test' { cmd /c "echo npm warn deprecated something 1>&2 & exit 0" }
Write-Output 'after the tool'
'@
        $result.ExitCode | Should -Be 0
        $result.Output | Should -Match 'after the tool'
        $result.Output | Should -Match '::warning title=Tools - test::npm warn deprecated something'
    }

    It 'stops with the tool''s exit code when it fails' {
        $result = Invoke-StepScript -Body @'
Invoke-Tool 'Tools - test' { cmd /c "exit 3" }
Write-Output 'should not run'
'@
        $result.ExitCode | Should -Be 3
        $result.Output | Should -Not -Match 'should not run'
        $result.Output | Should -Match '::error title=Tools - test::exited with code 3'
    }
}
