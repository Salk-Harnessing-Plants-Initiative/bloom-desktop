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
   - downloads the currently installed version too if it isn't in `C:\BloomDeploy\releases\` yet (after a manual install), so it can be reinstalled (_nothing changed_ if it can't);
   - backs up `%USERPROFILE%\.bloom\data\bloom.db` and `%USERPROFILE%\.bloom\.env` into `C:\BloomDeploy\backups\<time>_v<old>\` and checks the copies;
   - installs with `Setup.exe --silent`, without starting the app;
   - **upgrades the database** with the release's migrations (`prisma migrate deploy`), and checks that no table lost rows. The app doesn't upgrade its own database;
   - checks the installed version, that `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and `BLOOM_USE_MOCK_DAQ` are `false`, that `.env` has CylinderScan mode, the station's scanner name and a real camera IP, and that there's enough free disk space;
   - **test upload:** runs the installed app's `--deploy-self-test` on a copy of the database. It uploads a 3-frame synthetic scan to Bloom (see [Test data in Bloom](#test-data-in-bloom)) with the app's own upload code, without the camera and without changing the station's database;
   - if the install, the database upgrade, a check or the test upload fails: reinstalls the previous version and restores `bloom.db` and `.env` from the backup;
   - keeps the newest 5 backups and writes a log to `C:\BloomDeploy\logs\`, which is also attached to the run.
4. **After a deploy,** when the camera is on, the operator checks the preview and a scan.

## Which station has which version

- **Actions → Station versions → Run workflow** prints a table of every active station with the version of its last successful deploy.
- The README's **Stations** table has a badge per station (last deploy succeeded or failed) and a link to its history.
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
3. **Register the runner.** In the organization's settings, **Actions → Runners → New self-hosted runner** (Windows, x64), and follow GitHub's commands in PowerShell, in a folder such as `C:\actions-runner`. When `config.cmd` asks:
   - runner group: `bloom-stations`;
   - labels: `windows` and the station's `runner_label` (e.g. `station-pc1`);
   - run as a service: **yes**, with the lab account (it asks for the account's Windows password; the password stays on the station).
4. **GitHub environment.** A repository admin creates the environment named in the station's `environment` field (e.g. `station-pc1`), with required reviewers and **Deployment branches: `main` only**.
5. **Add the station** to `deploy/stations.yaml` and to the README's Stations table (see [RELEASING.md](RELEASING.md#adding-a-station)).

The runner group `bloom-stations` is limited to this repository and to `.github/workflows/deploy.yml` on `main`, so no pull request or other workflow can run on a station.

Adding more stations needs no code change: steps 1–5 for each.

## Deploying

**Actions → Deploy → Run workflow**, branch `main`, with the version (e.g. `0.2.1`) and the station (e.g. `pc1`). Tick **require camera** only when the camera is switched on and should be checked too. Approve the run when asked. Choose a time when nobody is scanning: the deploy refuses to run while Bloom Desktop is open.

| Result in the job summary | Meaning                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `deployed`                | Installed, database upgraded, checks and test upload passed.                                                                       |
| `skipped-app-running`     | Bloom Desktop was open; nothing changed. Close it and run the deploy again.                                                        |
| `camera-unreachable`      | **require camera** was ticked and the camera didn't answer; nothing changed.                                                       |
| `bloom-check-failed`      | Bloom refused the station's login or doesn't know its scanner; nothing changed.                                                    |
| `rollback-unavailable`    | The installed version couldn't be downloaded for a rollback; nothing changed.                                                      |
| `rolled-back`             | The install, database upgrade, a check or the test upload failed; the previous version and data are back. The problems are listed. |
| `failed-no-rollback`      | First deploy to this station and it failed; the data was restored, but there was no earlier version to reinstall.                  |

If the test upload reports that it wrote no result while the runner runs as a service, the app may not be able to start in the service's session on that station. Run the runner from the lab account's desktop instead (`run.cmd` at sign-in) and tell the maintainers.

## Restoring a backup by hand

Close Bloom Desktop, then copy `bloom.db` and `.env` from the backup folder in `C:\BloomDeploy\backups\` back to `%USERPROFILE%\.bloom\data\` and `%USERPROFILE%\.bloom\`.
