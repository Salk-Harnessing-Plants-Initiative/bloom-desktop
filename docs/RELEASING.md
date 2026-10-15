# Releasing Bloom Desktop

Releases are made on demand from **Actions → Release → Run workflow**. The workflow (`.github/workflows/release.yml`) builds the installers once on GitHub-hosted runners and, only if every build passes, creates a **draft** GitHub Release with them. A maintainer publishes the draft, which creates the `vX.Y.Z` tag at the commit that was built. Every station installs those same files; station-specific settings are configuration, not build inputs (see [PILOT_COMPATIBILITY.md](PILOT_COMPATIBILITY.md)).

## What a release contains

| File                                         | Used by                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `Bloom-Desktop-X.Y.Z-Setup.exe`              | CylinderScan stations (Windows)                                       |
| `bloom_desktop-X.Y.Z-full.nupkg`, `RELEASES` | Squirrel (Windows installer internals)                                |
| `bloom-desktop_X.Y.Z_amd64.deb`              | GraviScan rigs (Linux), see note below                                |
| `manifest.json`                              | Version, commit, build time, and each file's size, SHA-256 and target |
| `SHA256SUMS`                                 | `sha256sum -c SHA256SUMS` to check a download is complete             |

Releases don't expire: every published version stays downloadable from the repository's **Releases** page, so any version can be reinstalled.

Both installers contain the whole app; each station runs one scanner mode, chosen in Machine Configuration.

> **Linux `.deb`:** it contains GraviScan as it currently is on `main`. Production GraviScan rigs still run the separate `feature/graviscan-prod` build, so don't install the `.deb` on a production rig until GraviScan on `main` is ready for them.

`SHA256SUMS` proves a download arrived intact. It does not prove the build itself is trustworthy: the checksums are computed from what CI built.

## Cutting a release

1. **Bump the version** in a PR into `development`: set `version` in `package.json` (Semantic Versioning, higher than the last release; Squirrel only upgrades to a higher version), run `npm install --package-lock-only` so `package-lock.json` matches, and move the `CHANGELOG.md` `[Unreleased]` entries under the new version.
2. **Promote** `development` to `main` with a PR (merge commit), and wait for `All Checks Passed` on the `main` merge commit.
3. **Start the release:** Actions → **Release** → **Run workflow** → branch `main` → type the version (e.g. `0.2.0`).
4. **Review the draft:** when the run finishes, a draft `v0.2.0` appears on the **Releases** page with the installers, `manifest.json` and `SHA256SUMS`. Before publishing, check it isn't marked **INCOMPLETE** and has every file listed in its `SHA256SUMS` plus `manifest.json` (see below). Drafts are visible to everyone with write access to the repository, not the public.
5. **Publish it:** @blm3886 or @eberrigan (the only accounts allowed to create tags) clicks **Publish release**. This creates the `v0.2.0` tag at the built commit and makes the release public and permanent: with immutable releases on, its files and tag can't be changed afterwards.
   - Editing the notes first is fine. Don't change the draft's **Tag** or **Target**; the Target is the commit in `manifest.json`.
   - To publish without opening the edit page: `gh release edit v0.2.0 --draft=false`.

The workflow stops, before building, if:

- it wasn't started from `main`;
- the version typed doesn't match `package.json` (`0.2.1` vs `0.2.0`);
- `All Checks Passed` hasn't succeeded on the `main` commit;
- that version is already released or tagged (releases are never overwritten).

No tag exists until the draft is published. Release tags (`v*`) can't be deleted or moved by anyone, and only @blm3886 and @eberrigan can create any tag (repository rulesets).

### When a release run fails

A failed run leaves no tag and no release. If uploading the draft fails, the workflow deletes the draft, except in three cases: the upload stalled (the draft is kept, marked **INCOMPLETE — do not publish**, for you to inspect), the workflow couldn't delete it, or the run was cancelled. Never publish an INCOMPLETE or partial draft: with immutable releases on, that would ship it permanently. What to do depends on the cause:

| Cause                                                                                    | What to do                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "CI is still running…"                                                                   | Wait for `All Checks Passed` on `main` to finish, then **Re-run failed jobs**.                                                                                                                                                                       |
| Runner or network problem (job not picked up, lost connection, download or upload error) | **Re-run failed jobs**. Within 3 days, the build outputs from the first attempt are reused. After 3 days, use **Re-run all jobs**.                                                                                                                   |
| A problem in the code or build                                                           | A re-run rebuilds the same commit, so it will fail again. Fix it on `development`, promote, and run the workflow again with the same version.                                                                                                        |
| "… is already released" / "Tag … already exists"                                         | That version is published; bump the version for a new one.                                                                                                                                                                                           |
| "A release or draft for … already exists"                                                | A draft from an earlier run. Publish it only if it isn't marked INCOMPLETE, has every file listed in its `SHA256SUMS` plus `manifest.json`, and was built from the commit you want (`commit` in `manifest.json`). Otherwise delete it and run again. |
| "The upload timed out after 10 minutes"                                                  | The partial draft was kept and marked **INCOMPLETE — do not publish** so you can see what was uploaded. Delete it on the Releases page, then **Re-run failed jobs**.                                                                                 |
| "Couldn't delete the incomplete draft" / "Couldn't find the draft"                       | Delete any draft for that version on the Releases page, then **Re-run failed jobs**.                                                                                                                                                                 |
| You cancelled the run while it was creating the draft                                    | Delete any draft for that version on the Releases page before running again.                                                                                                                                                                         |

**Pre-releases:** releasing a version like `0.2.0-rc.1` (with `package.json` at `0.2.0-rc.1` on `main`) publishes a GitHub pre-release tagged `v0.2.0-rc.1`, useful for trying a build on one station first. Notes:

- Keep the number below 10 (`rc.1`…`rc.9`). The Windows installer drops the dot (`rc.10` → `rc10`) and compares the label as text, so `rc10` would sort below `rc2`.
- The Linux file is published as `bloom-desktop_X.Y.Z-rc.N_amd64.deb`; the package version inside it is `X.Y.Z~rc.N`, which Debian sorts before `X.Y.Z`.
- Bump `package.json` to the final `X.Y.Z` before the next promotion, so a final release isn't attempted while it still says `-rc`.

## Adding a station

Add an entry to `deploy/stations.yaml` in a PR into `development`:

```yaml
stations:
  - name: pc1
    type: cylinderscan # cylinderscan (Windows) | graviscan (Linux)
    os: windows
    location: Greenhouse bench 1
    bloom_scanner_name: PBIOBScanner # as registered in Bloom
    environment: station-pc1 # GitHub environment for deployments
    runner_label: station-pc1 # the station's self-hosted runner label
    active: true
```

The file is public. CI (`npm run stations:validate`) rejects unknown fields and top-level keys, credential-like field names, and any value containing an IPv4/IPv6 address or a URL with a password. It can't catch hostnames or YAML comments, so keep camera IPs, credentials and mock-mode settings on the station itself.
