# Pester 5 tests for deploy/windows/StationData.psm1: backups of bloom.db and .env, the
# copy kept of a failed deploy's database, and restoring a backup. Files live in TestDrive.

BeforeAll {
    Import-Module (Join-Path $PSScriptRoot '..\..\deploy\windows\StationData.psm1') -Force

    function New-StationProfile {
        $userProfile = Join-Path $TestDrive ('profile-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path (Join-Path $userProfile '.bloom\data') | Out-Null
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db') -Value 'db-bytes'
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\.env') -Value 'SCANNER_MODE=cylinderscan'
        $userProfile
    }
}

Describe 'Backup-StationData' {
    BeforeEach {
        $userProfile = New-StationProfile
        $backupRoot = Join-Path $TestDrive ('backups-' + [guid]::NewGuid())
    }

    It 'copies bloom.db and .env into a folder named for the old version' {
        $backup = Backup-StationData -ProfileDir $userProfile -BackupRoot $backupRoot -OldVersion '0.1.0'
        $backup | Should -Match '_v0\.1\.0$'
        Get-Content (Join-Path $backup 'bloom.db') | Should -Be 'db-bytes'
        Get-Content (Join-Path $backup '.env') | Should -Be 'SCANNER_MODE=cylinderscan'
    }

    It 'copies a journal file left next to the database' {
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db-journal') -Value 'journal'
        $backup = Backup-StationData -ProfileDir $userProfile -BackupRoot $backupRoot -OldVersion '0.1.0'
        Get-Content (Join-Path $backup 'bloom.db-journal') | Should -Be 'journal'
    }

    It 'works on a first install with no database yet' {
        Remove-Item -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db')
        { Backup-StationData -ProfileDir $userProfile -BackupRoot $backupRoot } | Should -Not -Throw
    }
}

Describe 'Remove-OldBackups' {
    It 'keeps the newest N and never the protected one' {
        $root = Join-Path $TestDrive 'old-backups'
        $names = '20260101-000000_v0.1.0', '20260102-000000_v0.1.1', '20260103-000000_v0.1.2', '20260104-000000_v0.1.3'
        foreach ($n in $names) { New-Item -ItemType Directory -Force -Path (Join-Path $root $n) | Out-Null }
        $protected = Join-Path $root $names[0]
        Remove-OldBackups -BackupRoot $root -Keep 2 -Protect $protected
        (Get-ChildItem $root -Directory).Name | Sort-Object | Should -Be @($names[0], $names[2], $names[3])
    }
}

Describe 'Save-FailedDatabase' {
    It 'keeps the database and its journal in a dated folder for the failed version' {
        $userProfile = New-StationProfile
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db-journal') -Value 'journal'
        $failedRoot = Join-Path $TestDrive ('failed-' + [guid]::NewGuid())
        $kept = Save-FailedDatabase -ProfileDir $userProfile -FailedRoot $failedRoot -Version '0.2.1'
        Split-Path -Leaf $kept | Should -Match '^\d{8}-\d{6}_v0\.2\.1$'
        Get-Content (Join-Path $kept 'bloom.db') | Should -Be 'db-bytes'
        Get-Content (Join-Path $kept 'bloom.db-journal') | Should -Be 'journal'
        Get-Content (Join-Path $userProfile '.bloom\data\bloom.db') | Should -Be 'db-bytes'
    }

    It 'keeps only the newest five failed copies' {
        $userProfile = New-StationProfile
        $failedRoot = Join-Path $TestDrive ('failed-' + [guid]::NewGuid())
        foreach ($day in 1..6) { New-Item -ItemType Directory -Force -Path (Join-Path $failedRoot ('2026010{0}-000000_v0.2.0' -f $day)) | Out-Null }
        $kept = Save-FailedDatabase -ProfileDir $userProfile -FailedRoot $failedRoot -Version '0.2.1'
        (Get-ChildItem $failedRoot -Directory) | Should -HaveCount 5
        Test-Path $kept | Should -BeTrue
    }

    It 'does nothing when there is no database' {
        $userProfile = New-StationProfile
        Remove-Item -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db')
        Save-FailedDatabase -ProfileDir $userProfile -FailedRoot (Join-Path $TestDrive 'failed-none') -Version '0.2.1' |
            Should -BeNullOrEmpty
    }
}

Describe 'Restore-StationData' {
    It 'puts bloom.db and .env back and removes a stale journal' {
        $userProfile = New-StationProfile
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db') -Value 'upgraded-db'
        Set-Content -LiteralPath (Join-Path $userProfile '.bloom\data\bloom.db-journal') -Value 'stale'
        $backup = Join-Path $TestDrive ('backup-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        Set-Content -LiteralPath (Join-Path $backup 'bloom.db') -Value 'old-db'
        Set-Content -LiteralPath (Join-Path $backup '.env') -Value 'SCANNER_NAME=Old'
        Restore-StationData -BackupDir $backup -ProfileDir $userProfile
        Get-Content (Join-Path $userProfile '.bloom\data\bloom.db') | Should -Be 'old-db'
        Get-Content (Join-Path $userProfile '.bloom\.env') | Should -Be 'SCANNER_NAME=Old'
        Test-Path (Join-Path $userProfile '.bloom\data\bloom.db-journal') | Should -BeFalse
    }
}
