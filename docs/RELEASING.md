# Releasing Bloom Desktop

A release is a `vX.Y.Z` git tag on `main`. Pushing the tag runs `.github/workflows/release.yml`, which builds the installers once on GitHub-hosted runners and publishes them as a GitHub Release. Every station installs those same files; station-specific settings are configuration, not build inputs (see [Hardware Mode](PILOT_COMPATIBILITY.md#hardware-mode-mock-vs-real)).

## What a release contains

| File                                         | Used by                                                               |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `Bloom-Desktop-X.Y.Z-Setup.exe`              | CylinderScan stations (Windows)                                       |
| `bloom_desktop-X.Y.Z-full.nupkg`, `RELEASES` | Squirrel (Windows installer internals)                                |
| `bloom-desktop_X.Y.Z_amd64.deb`              | GraviScan rigs (Linux)                                                |
| `manifest.json`                              | Version, commit, build time, and each file's size, SHA-256 and target |
| `SHA256SUMS`                                 | `sha256sum -c SHA256SUMS` before installing                           |

Releases don't expire: every published version stays downloadable from the repository's **Releases** page, so any version can be reinstalled.

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

If a build fails, nothing is published; fix the cause and re-run the workflow for the same tag.

**Pre-releases:** a tag like `v0.2.0-rc.1` (with `package.json` at `0.2.0-rc.1`) is published as a GitHub pre-release, useful for trying a build on one station first.

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

The file is public. CI (`npm run stations:validate`) rejects unknown fields, credential-like fields, and any value containing an IP address. Keep camera IPs, credentials and mock-mode settings on the station itself.
