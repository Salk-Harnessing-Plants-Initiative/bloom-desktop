# GraviScan Linux Packaged-App Deployment

How the packaged (not dev-mode) GraviScan build is deployed on a Linux lab
machine: the `libusb-filter.so`/`LD_PRELOAD` mechanism, why the app ships
as `.deb`, and systemd/permissions caveats for the packaged app itself
(not the SANE scanner driver, which is covered by
[GRAVISCAN_SCANNER_DRIVER_SETUP.md](GRAVISCAN_SCANNER_DRIVER_SETUP.md)).

## The `libusb-filter.so` / `LD_PRELOAD` mechanism

### Why it exists

The `epkowa` SANE backend (used by the Epson Perfection V600 scanner) opens
and claims USB interfaces on **every** connected Epson scanner during
`sane_open()`, even when a caller only asked to open one. On a GraviScan
rig with multiple scanners attached, this prevents parallel scanning:
two scan-worker processes can't each claim their own device, because the
first process to call `sane_open()` grabs every Epson USB interface on the
bus, not just its own.

`src/main/native/libusb-filter.c` is a small `LD_PRELOAD` shim that
intercepts `libusb_open()` and restricts each scan-worker process to the
one scanner it's actually supposed to talk to (identified by USB
bus:device, via the `SANE_USB_FILTER` environment variable). Without it,
every other connected Epson scanner is rejected with `LIBUSB_ERROR_BUSY`
when a second process tries to claim it — parallel multi-scanner
operation breaks, not silently, but not with a crash either.

### How it's wired for a packaged (not dev-mode) install

Three pieces, all Linux-only:

1. **Build**: `npm run build:native` (`scripts/build-libusb-filter.sh`)
   compiles `src/main/native/libusb-filter.c` into
   `src/main/native/libusb-filter.so`. This runs automatically as part of
   `npm run make`/`npm run make:linux`/`npm run package`/`npm run dev` — it
   is not a separate manual step.
2. **Packaging**: `forge.config.ts`'s `packagerConfig.extraResource`
   includes `./src/main/native/libusb-filter.so`, but only when
   `process.platform === 'linux'` — this keeps macOS/Windows packaging
   from erroring on a file that doesn't exist for those platforms. For a
   packaged Linux install, the `.so` ends up at `Resources/libusb-filter.so`
   inside the app's installed layout (unpacked, outside the asar archive —
   the same reasoning as Prisma's native binaries; see
   [PACKAGING.md](PACKAGING.md)).
3. **Runtime**: `src/main/graviscan/scanner-subprocess.ts`'s
   `ScannerSubprocess.spawn()` resolves the `.so` path differently
   depending on whether the app is packaged:
   - Packaged: `path.join(process.resourcesPath, 'libusb-filter.so')`
   - Dev mode: `path.join(process.cwd(), 'src', 'main', 'native', 'libusb-filter.so')`

   That path is passed into `buildSubprocessEnv()`, which — only on Linux,
   and only when the scanner subprocess is **not** running in mock mode —
   sets three environment variables on the spawned scan-worker process:
   - `LD_PRELOAD` = the resolved `.so` path
   - `SANE_USB_FILTER` = the target scanner's USB `bus:device` (parsed
     from its SANE device name, e.g. `epkowa:interpreter:001:007` →
     `001:007`)
   - `LIBUSB_ENDPOINT_RECOVERY` = `true` by default (`false` only if the
     main process's own environment explicitly sets it to `false`) —
     controls whether the shim also recovers a stalled USB endpoint after
     a `TIMEOUT`/`PIPE` error, a separate fix for a different issue (#228)

   On macOS/Windows, or in mock mode, none of these three variables are
   set — the shim is never loaded, matching those platforms not needing
   USB-interface isolation at all.

This is exactly the same mechanism in dev mode and in a packaged install;
only the `.so`'s filesystem path differs. **No code change was needed to
document this** — it was already correct and already shipped (added in
the archived `add-ld-preload-to-subprocess` change); this doc exists
because, until now, it had never been written down anywhere.

## Why `.deb`, not `.rpm` or AppImage

`forge.config.ts` configures both `MakerDeb` and `MakerRpm` for Linux.
Only `.deb` is what the real GraviScan lab machine actually needs:
`graviscan-ms-7c56` (and the driver-setup verification box, `pbiob-gh-04`)
run Ubuntu 24.04+/26.04 — an apt/dpkg-based distribution — confirmed in
[GRAVISCAN_SCANNER_DRIVER_SETUP.md](GRAVISCAN_SCANNER_DRIVER_SETUP.md).
There is no rpm-based or AppImage-only GraviScan machine today.

- **`.deb`** is the CI-verified, gate-blocking artifact (see
  `.github/workflows/pr-checks.yml`'s `test-make-linux` job) — this is
  what an actual lab machine installs via `sudo dpkg -i`.
- **`.rpm`** stays configured in `forge.config.ts` for anyone who wants to
  attempt a local/future build for a non-Ubuntu machine, but it is not
  verified in CI: this environment's `rpm` toolchain has a real,
  reproducible incompatibility (an `rpm`-6.x/rpmdb-permission issue,
  unrelated to anything this app controls) that made `@electron-forge/maker-rpm`
  fail outright during testing. Since nothing today depends on `.rpm`
  working, CI simply doesn't run that maker — see
  `openspec/changes/add-graviscan-linux-packaging-ci/design.md` Decision 3
  for the full investigation.
- **AppImage** was considered (electron-forge supports an AppImage maker)
  and deliberately not added — the real lab machine's apt/dpkg tooling
  already covers deployment, and AppImage would only add build time for a
  format nobody needs. See that same design.md's Context section for the
  full reasoning.

## systemd / permissions for the packaged app

This is about running the **packaged application itself** — the scanner's
own USB device permissions (udev rules for the V600) are a separate,
already-documented concern; see
[GRAVISCAN_SCANNER_DRIVER_SETUP.md](GRAVISCAN_SCANNER_DRIVER_SETUP.md)
for those.

- **No systemd unit or autostart configuration exists in this repo
  today.** There is no `.service` file, and nothing in the codebase
  invokes `systemctl` or otherwise manages the app as a systemd service.
  The packaged app is launched manually (e.g. from a desktop launcher or
  a terminal), not run as a background daemon. If autostart-on-boot or
  automatic-restart-on-crash behavior is ever wanted for a GraviScan rig,
  that would be new work, not something this doc can point to as already
  existing — file it as its own request rather than assuming a unit is
  waiting to be discovered.
- **Run as a normal user, not root.** The packaged `.deb` does not
  require or expect root to run (only `dpkg -i`, the install step itself,
  needs `sudo`). Running the app itself as root is not necessary and not
  recommended — the scanner's udev rules already grant the appropriate
  non-root user USB access (see the driver-setup doc), and running as
  root would create root-owned files under the app's data directory
  (below), which a later non-root run couldn't clean up.
- **The database path depends on which user account runs the app.** Per
  [PACKAGING.md](PACKAGING.md)'s "Development vs Production" table, the
  production database lives at `~/.bloom/data/bloom.db` — resolved via
  Electron's `app.getPath('home')`, i.e. the home directory of whichever
  user account actually launches the packaged app. If the app is ever
  launched under a different user/session than the one a rig's operator
  normally uses (e.g. testing as one user, then handing the rig to
  another), each user gets their own separate database — there is no
  shared system-wide data directory. Keep the launching user consistent
  across a rig's normal operation to avoid split/duplicated experiment
  data.

## Related Documentation

- [GraviScan Scanner Driver Setup](GRAVISCAN_SCANNER_DRIVER_SETUP.md) —
  SANE/`iscan`/`epkowa` driver install and udev rules (the scanner's own
  USB permissions, not the packaged app's)
- [Packaging & Distribution](PACKAGING.md) — cross-platform packaging
  mechanics (Prisma, Python bundling, ASAR)
- `openspec/changes/add-graviscan-linux-packaging-ci/design.md` — the
  full investigation behind this doc's deb/rpm/AppImage decision and the
  Linux packaging CI job
