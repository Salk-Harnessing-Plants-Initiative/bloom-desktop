# Releasing Bloom Desktop

A release is a `vX.Y.Z` git tag on `main`. Pushing the tag runs `.github/workflows/release.yml`, which builds the installers once on GitHub-hosted runners and publishes them as a GitHub Release. Every station installs those same files; station-specific settings are configuration, not build inputs (see [PILOT_COMPATIBILITY.md](PILOT_COMPATIBILITY.md)).

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
2. **Promote** `development` to `main` with a PR (merge commit).
3. **Wait** for `All Checks Passed` on the `main` merge commit.
4. **Tag** that commit and push the tag:
   ```bash
   git fetch origin main
   git tag v0.2.0 origin/main
   git push origin v0.2.0
   ```
5. **Watch** the Release workflow in the Actions tab. When it finishes, the release appears on the Releases page.

The workflow refuses to publish, without building, if:

- the tag doesn't match `package.json` (`v0.2.1` vs `0.2.0`);
- the tagged commit isn't on `main`;
- `All Checks Passed` hasn't succeeded on that commit;
- a release for the tag already exists (releases are never overwritten).

Release tags can't be deleted or moved, and only maintainers can create them (repository rulesets).

### When a release run fails

Nothing is published unless every job succeeds. What to do depends on the cause:

| Cause                                                                          | What to do                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI on the tagged commit was still running ("CI is still running…")             | Wait for `All Checks Passed` to finish, then **Re-run failed jobs**.                                                                                                                   |
| Runner or network problem (job not picked up, lost connection, download error) | **Re-run failed jobs**. Within 3 days, the build outputs from the first attempt are reused.                                                                                            |
| A problem in the code or build                                                 | A re-run rebuilds the same commit, so it will fail again. Fix it on `development`, bump the patch version (`0.2.0` → `0.2.1`), promote, and tag `v0.2.1`. The failed tag stays unused. |
| "A release for … already exists"                                               | That version is already published; bump the version for a new one.                                                                                                                     |

**Pre-releases:** a tag like `v0.2.0-rc.1` (with `package.json` at `0.2.0-rc.1` on `main`) is published as a GitHub pre-release, useful for trying a build on one station first. Notes:

- Keep the number below 10 (`rc.1`…`rc.9`). The Windows installer drops the dot (`rc.10` → `rc10`) and compares the label as text, so `rc10` would sort below `rc2`.
- The Linux file is published as `bloom-desktop_X.Y.Z-rc.N_amd64.deb`; the package version inside it is `X.Y.Z~rc.N`, which Debian sorts before `X.Y.Z`.
- Bump `package.json` to the final `X.Y.Z` before the next promotion, so a final release isn't tagged while it still says `-rc`.

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
