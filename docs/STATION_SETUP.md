# Station setup and deploys

How a Windows CylinderScan station is set up to receive releases from **Actions → Deploy → Run workflow**, and what a deploy does. Releases themselves are made as in [RELEASING.md](RELEASING.md).

## What a deploy does

1. **Plan** (GitHub-hosted runner): the station is in `deploy/stations.yaml`, active, and a Windows CylinderScan station; the release `vX.Y.Z` is published (not a draft) and has its installer, `manifest.json` and `SHA256SUMS`.
2. **Approval:** the run waits until a required reviewer of the station's environment approves it.
3. **Deploy** (the station's runner), `deploy/windows/deploy-station.ps1`. Steps marked _nothing changed_ stop the deploy without touching the station:
   - downloads the release's Windows files into `C:\BloomDeploy\releases\vX.Y.Z\` and checks each against `SHA256SUMS` (_nothing changed_ if one doesn't match);
   - stops if Bloom Desktop is running (_nothing changed_);
   - pings the camera at the IP in `.env`. Cameras are usually off between sessions, so this is only reported, unless the run's **require camera** box is ticked (_nothing changed_ if it doesn't answer);
   - logs in to Bloom with the station's saved credentials and checks its scanner is registered, without writing anything (_nothing changed_ if it fails);
   - checks the station's settings: `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and `BLOOM_USE_MOCK_DAQ` are `false`, `.env` has CylinderScan mode, the station's scanner name, a real camera IP and an existing scans folder, and there's at least 20 GB free on the scans drive and 5 GB for installers and backups (_nothing changed_ if not);
   - downloads the currently installed version too, so it can be reinstalled, if it isn't in `C:\BloomDeploy\releases\` yet (after a manual install) or its staged files no longer match `SHA256SUMS` (_nothing changed_ if it can't);
   - reads the database, to compare row counts after the upgrade (_nothing changed_ if it can't);
   - backs up `%USERPROFILE%\.bloom\data\bloom.db` and `%USERPROFILE%\.bloom\.env` into `C:\BloomDeploy\backups\<time>_v<old>\` and checks the copies;
   - installs with `Setup.exe --silent`, without starting the app;
   - **upgrades the database** with the release's migrations (`prisma migrate deploy`), and checks that no table lost rows. The app doesn't upgrade its own database;
   - checks the new version is the one installed;
   - **test upload:** runs the installed app's `--deploy-self-test` on a copy of the database. It uploads a 3-frame synthetic scan to Bloom (see [Test data in Bloom](#test-data-in-bloom)) with the app's own upload code, without the camera and without changing the station's database;
   - if the install, the database upgrade, a check or the test upload fails: keeps the database it left behind in `C:\BloomDeploy\failed\<time>_v<new>\`, restores `bloom.db` and `.env` from the backup and checks them, then reinstalls the previous version and checks it is installed;
   - keeps the newest 5 backups and 5 failed copies, and writes a log to `C:\BloomDeploy\logs\`; this run's log is attached to the run. The log and the job summary are public, so the station's user paths, account, camera address and Bloom details are replaced in them.
4. **After a deploy,** when the camera is on, the operator checks the preview and a scan.

## Which station has which version

- **Actions → Station versions → Run workflow** prints a table of every active station with the version of its last successful deploy.
- The README's **Stations** table has a badge per station (last deploy succeeded or failed) and a link to its history. A red badge can mean anything from "nothing changed" to "needs a restore by hand": the run's job summary says which. After `needs-attention` or `rollback-failed` the station may be running the new version even though Station versions shows the old one.
- **Settings → Environments → station-…** lists every deployment of a station: version (linked to the release), commit, who approved it, and the result. A rolled-back deploy shows as failed.

Only deploys made with Actions → Deploy are recorded; a manual install isn't.

## Test data in Bloom

Every deploy uploads one synthetic plant to Bloom, filed as:

|                          |                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------- |
| Species                  | `Sorghum` (`TEST_SPECIES` in `.github/workflows/deploy.yml`; must exist in Bloom) |
| Experiment               | `DEPLOY-TEST <scanner name>`, one per station                                     |
| Plant                    | `DEPLOY-<version>-<time>`                                                         |
| Accession                | `DEPLOY-TEST`                                                                     |
| Phenotyper and scientist | Deploy Self-Test, `deploy-self-test@bloom-desktop.invalid`                        |

Leave out experiments starting with `DEPLOY-TEST` when analysing or exporting Bloom data.

## Setting up a station (once)

Do this on the station, signed in as its shared lab account: Squirrel installs per user, and `~/.bloom` and the mock-mode variables are per user, so the runner must run as that account.

1. **Database.** A station that has data from bloom-desktop-pilot needs it converted first; see [PILOT_COMPATIBILITY.md](PILOT_COMPATIBILITY.md). The converted database goes in `%USERPROFILE%\.bloom\data\bloom.db`.
2. **Machine settings.** Install Bloom Desktop once by hand and complete Machine Configuration (CylinderScan, scanner name, camera IP, scans folder, Bloom account). Set the user environment variables `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and `BLOOM_USE_MOCK_DAQ` to `false` (System Properties → Environment Variables → User variables).
3. **Install Git for Windows** (https://git-scm.com/download/win, default options). The deploy checks out the release's database migrations with it and checks they are the released commit.
4. **Register the runner on this repository.** In the repository's **Settings → Actions → Runners → New self-hosted runner** (Windows, x64), follow GitHub's commands in PowerShell, in `C:\actions-runner`. When `config.cmd` asks:
   - runner name: the station's `runner_label` (e.g. `station-pc1`), not the default (the computer's name), which would appear in every public job log;
   - labels: `windows` and the station's `runner_label` (e.g. `station-pc1`);
   - run as a service: **yes**, with the lab account (it asks for the account's Windows password; the password stays on the station).

   Register it on the repository, not the organization, so no other repository can use it.

5. **Install the job hook**, which lets only the Deploy workflow from `main` run on the station. The repository is public and the organization's plan can't limit a runner to one workflow, so without it a workflow from a fork pull request or a pushed branch that names the station's labels would run as the lab account. The hook refuses the job if it can't run its check. In PowerShell as an administrator, after step 4 (it takes the lab account from the runner service and stops with an error if anything doesn't work):

   ```powershell
   $ErrorActionPreference = 'Stop'
   [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

   # The hook and the deploy are PowerShell scripts, which Windows blocks by default.
   Set-ExecutionPolicy -Scope LocalMachine RemoteSigned -Force
   $policy = Get-ExecutionPolicy
   if ($policy -notin 'RemoteSigned', 'Unrestricted', 'Bypass') { throw "Scripts are still blocked ($policy), probably by Group Policy: ask IT." }

   # The account the runner service runs as (step 4).
   $service = @(Get-CimInstance Win32_Service -Filter "Name LIKE 'actions.runner.%'")
   if ($service.Count -ne 1) { throw "Expected one runner service, found $($service.Count): do step 4 first." }
   $labAccount = $service[0].StartName -replace '^\.\\', "$env:COMPUTERNAME\"
   $lab = '*' + ([Security.Principal.NTAccount]$labAccount).Translate([Security.Principal.SecurityIdentifier]).Value
   "Runner service account: $labAccount"

   $raw = 'https://raw.githubusercontent.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/main/deploy/windows'
   New-Item -ItemType Directory -Force C:\actions-runner\hooks, C:\BloomDeploy | Out-Null
   foreach ($file in 'runner-job-started.ps1', 'RunnerJobCheck.psm1') {
       Invoke-WebRequest "$raw/$file" -OutFile "C:\actions-runner\hooks\$file" -UseBasicParsing
   }
   # On a line of its own, even if .env doesn't end with a newline:
   Add-Content C:\actions-runner\.env "`r`nACTIONS_RUNNER_HOOK_JOB_STARTED=C:\actions-runner\hooks\runner-job-started.ps1"

   # Permissions by SID, so any Windows language works. Administrators and SYSTEM keep full control.
   function Set-Access([string]$Path, [string]$LabRights) {
       icacls $Path /inheritance:r /grant:r "${lab}:$LabRights" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
       if ($LASTEXITCODE) { throw "icacls failed on $Path" }
   }
   # Only the lab account may use the runner and the deploy folder (backups hold .env).
   Set-Access C:\actions-runner '(OI)(CI)F'
   Set-Access C:\BloomDeploy '(OI)(CI)F'
   # The hook and the runner's settings: read-only for the lab account, so a job can't switch the hook off.
   Set-Access C:\actions-runner\hooks '(OI)(CI)RX'
   icacls C:\actions-runner\.env /inheritance:r /grant:r "${lab}:R" '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
   if ($LASTEXITCODE) { throw 'icacls failed on C:\actions-runner\.env' }

   Restart-Service 'actions.runner.*'
   Get-Service 'actions.runner.*'   # Status should be Running
   ```

   Every job then logs `Station job hook: Deploy workflow from main, allowed.`, and anything else fails with `Refused by the station's job hook`. When `runner-job-started.ps1` or `RunnerJobCheck.psm1` changes in the repository, download them again. If even a Deploy run from `main` is refused with an empty workflow name, the runner isn't passing the job's details to the hook: tell the maintainers rather than removing the hook.

   The hook keeps other workflows from starting on the station, and the lab account can't change the hook or the runner's settings. Code already running as the lab account could still change other runner files, which is why only the Deploy workflow from `main`, after approval, may run there. If a job fails with "running scripts is disabled on this system", the execution policy step above didn't take effect.

6. **GitHub environment.** A repository admin creates the environment named in the station's `environment` field (e.g. `station-pc1`), with required reviewers and **Deployment branches: `main` only**.
7. **Repository setting (once, for all stations):** **Settings → Actions → General → Approval for running fork pull request workflows → Require approval for all external contributors.**
8. **Add the station** to `deploy/stations.yaml` and to the README's Stations table (see [RELEASING.md](RELEASING.md#adding-a-station)).

Adding more stations needs no code change: steps 1–6 and 8 for each.

## Deploying

**Actions → Deploy → Run workflow**, branch `main`, with the version (e.g. `0.2.1`) and the station (e.g. `pc1`). Tick **require camera** only when the camera is switched on and should be checked too. Approve the run when asked. Choose a time when nobody is scanning: the deploy refuses to run while Bloom Desktop is open.

| Result in the job summary | Meaning                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployed`                | Installed, database upgraded, checks and test upload passed.                                                                                                                                                   |
| `skipped-app-running`     | Bloom Desktop was open; nothing changed. Close it and run the deploy again.                                                                                                                                    |
| `camera-unreachable`      | **require camera** was ticked and the camera didn't answer; nothing changed.                                                                                                                                   |
| `bloom-check-failed`      | Bloom refused the station's login or doesn't know its scanner; nothing changed.                                                                                                                                |
| `rollback-unavailable`    | The installed version couldn't be downloaded for a rollback; nothing changed.                                                                                                                                  |
| `station-not-ready`       | A station setting is wrong (mock mode on, `.env` scanner or camera, scans folder, free space); nothing changed. The problems are listed.                                                                       |
| `database-unreadable`     | The station's `bloom.db` couldn't be read before the upgrade; nothing changed.                                                                                                                                 |
| `rolled-back`             | The install, database upgrade, a check or the test upload failed. The data was restored and checked, and the previous version is installed again. The problems are listed.                                     |
| `failed-same-version`     | Redeploying the installed version failed; the data was restored.                                                                                                                                               |
| `failed-no-rollback`      | First deploy to this station and it failed; the data was restored (if there was a database before), but the new version is still installed, as there was none to go back to. Don't scan; tell the maintainers. |
| `rollback-failed`         | The deploy failed and so did part of putting things back. The summary says which, and where the backup is: stop scanning and restore by hand (below).                                                          |
| `needs-attention`         | The deploy failed after Bloom Desktop was opened on the station, so nothing was put back: the new version is installed and the database may be partly upgraded. Stop scanning and restore by hand (below).     |
| `error`                   | An unexpected error, most often a download, checksum or backup failure before anything changed. The attached log says how far the deploy got.                                                                  |

If the test upload reports that it wrote no result while the runner runs as a service, the app may not be able to start in the service's session on that station. Run the runner from the lab account's desktop instead (`run.cmd` at sign-in) and tell the maintainers.

## Restoring a backup by hand

Use the backup folder named in the job summary (in `C:\BloomDeploy\backups\`). Scans saved on the station after that backup was made aren't in it, so stop scanning first.

1. Close Bloom Desktop.
2. Copy the whole `%USERPROFILE%\.bloom\data\` folder somewhere safe, e.g. `C:\BloomDeploy\failed\manual-<date>\`. After `needs-attention` nothing else has kept it, and it may hold scans saved since the deploy: if it does, tell the maintainers before going on.
3. Delete any `bloom.db-journal`, `bloom.db-wal` and `bloom.db-shm` next to the database in `%USERPROFILE%\.bloom\data\`.
4. Copy `bloom.db` (and any other `bloom.db-*` files in the backup) to `%USERPROFILE%\.bloom\data\`, and `.env` to `%USERPROFILE%\.bloom\`.
5. Unless the job summary says the previous version was reinstalled, uninstall Bloom Desktop (Settings → Apps), then run the previous version's `Setup.exe` from `C:\BloomDeploy\releases\v<version>\`. The installer won't replace a newer version, and the newer app doesn't work with the older database.

The database a failed deploy left behind is kept in `C:\BloomDeploy\failed\<time>_v<version>\`, for working out what went wrong; it isn't used again.
