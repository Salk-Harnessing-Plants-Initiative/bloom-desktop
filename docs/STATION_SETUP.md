# Station setup and deploys

How a Windows CylinderScan station is set up to receive releases from **Actions → Deploy → Run workflow**, and what a deploy does. Releases themselves are made as in [RELEASING.md](RELEASING.md).

## What a deploy does

1. **Plan** (GitHub-hosted runner): the station is in `deploy/stations.yaml`, active, and a Windows CylinderScan station; the release `vX.Y.Z` is published (not a draft) and has its installer, `manifest.json` and `SHA256SUMS`.
2. **Approval:** the run waits until a required reviewer of the station's environment approves it.
3. **Deploy** (the station's runner), `deploy/windows/deploy-station.ps1`:
   - downloads the release's Windows files into `C:\BloomDeploy\releases\vX.Y.Z\` and checks each against `SHA256SUMS`;
   - stops without changing anything if Bloom Desktop is running;
   - backs up `%USERPROFILE%\.bloom\data\bloom.db` and `%USERPROFILE%\.bloom\.env` into `C:\BloomDeploy\backups\<time>_v<old>\` and checks the copies;
   - installs with `Setup.exe --silent`, without starting the app;
   - checks the installed version, that `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and `BLOOM_USE_MOCK_DAQ` are `false`, that `.env` has CylinderScan mode, the station's scanner name and a real camera IP, and that there's enough free disk space;
   - if the install or a check fails, reinstalls the previous version from `C:\BloomDeploy\releases\`;
   - keeps the newest 5 backups and writes a log to `C:\BloomDeploy\logs\`.
4. **After a deploy,** the operator opens Bloom Desktop and checks the camera preview, a scan, and the Bloom upload. The first launch after an upgrade also updates the database.

Each station's environment on GitHub (**Settings → Environments → station-…**) lists every deployment: version, commit, who approved it, and the result.

## Setting up a station (once)

Do this on the station, signed in as its shared lab account: Squirrel installs per user, and `~/.bloom` and the mock-mode variables are per user, so the runner must run as that account.

1. **Machine settings.** Open Bloom Desktop and complete Machine Configuration (CylinderScan, scanner name, camera IP, Bloom account). Set the user environment variables `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and `BLOOM_USE_MOCK_DAQ` to `false` (System Properties → Environment Variables → User variables).
2. **Register the runner.** In the organization's settings, **Actions → Runners → New self-hosted runner** (Windows, x64), and follow GitHub's commands in PowerShell, in a folder such as `C:\actions-runner`. When `config.cmd` asks:
   - runner group: `bloom-stations`;
   - labels: `windows` and the station's `runner_label` (e.g. `station-pc1`);
   - run as a service: **yes**, with the lab account (it asks for the account's password; the password stays on the station).
3. **GitHub environment.** A repository admin creates the environment named in the station's `environment` field (e.g. `station-pc1`), with required reviewers and **Deployment branches: `main` only**.
4. **Add the station** to `deploy/stations.yaml` (see [RELEASING.md](RELEASING.md#adding-a-station)).

The runner group `bloom-stations` is limited to this repository and to `.github/workflows/deploy.yml` on `main`, so no pull request or other workflow can run on a station.

## Deploying

**Actions → Deploy → Run workflow**, branch `main`, with the version (e.g. `0.2.0`) and the station (e.g. `pc1`). Approve the run when asked. Choose a time when nobody is scanning: the deploy refuses to run while Bloom Desktop is open.

| Result in the job summary | Meaning                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `deployed`                | Installed and checked. The operator opens the app to confirm.                         |
| `skipped-app-running`     | Bloom Desktop was open; nothing changed. Close it and run the deploy again.           |
| `rolled-back`             | The install or a check failed; the previous version is back. The problems are listed. |
| `failed-no-rollback`      | First deploy to this station and it failed; there was nothing to roll back to.        |

## Restoring a backup by hand

Close Bloom Desktop, then copy `bloom.db` and `.env` from the backup folder in `C:\BloomDeploy\backups\` back to `%USERPROFILE%\.bloom\data\` and `%USERPROFILE%\.bloom\`.
