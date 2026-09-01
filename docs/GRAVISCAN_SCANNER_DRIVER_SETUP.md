# GraviScan Scanner Driver Setup (Epson V600 / iscan / epkowa)

How to install the Epson `iscan`/`epkowa` SANE driver for the Perfection
V600 on a fresh Ubuntu 24.04+ machine, without permanently breaking
`apt` in the process.

## Background

Historically, setting up a new GraviScan rig required force-installing
`iscan` with `sudo dpkg --ignore-depends=libsane -i iscan_*.deb`,
because Ubuntu 24.04 renamed `libsane` to `libsane1` and the old
`iscan` build only declared a hard dependency on the former. (Ubuntu
26.04 separately renamed `libxml2` to `libxml2-16` — a different
package, a different release, addressed by [step 2](#2-fix-libxml2--a-two-level-problem)
below. These are two independent renames, not one event.)

That workaround "works" in the sense that scanning functions
afterward, but it leaves `apt`'s dependency graph in a genuinely
broken state — every subsequent `apt install`/`apt upgrade` on the
machine fails with `iscan : Depends: libsane (>= 1.0.11-3) but it is
not installable`, because `--ignore-depends` doesn't fix the
dependency, it just tells dpkg to skip checking it once. This is
documented in [issue #226](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/226),
which affects the real production rig (`graviscan-ms-7c56`).

This doc and `scripts/setup-graviscan-scanner-driver.sh` replace that
workaround with a real fix: verified 2026-07-24 on a fresh Ubuntu 26.04
box (`pbiob-gh-04`) against a physically connected Perfection V600,
confirmed with an actual scan (not just device enumeration).

## Quick Start

1. Download the iscan driver bundle for your scanner model yourself —
   Epson's download portal (`download.ebz.epson.net`) blocks scripted
   fetches, so this step can't be automated. Search for your model
   (e.g. "V600" or its internal code "GT-X820"), pick **Linux Deb(x64)**,
   and download **"Image Scan! for Linux"** (this is `iscan` — not
   "Epson Scan2", which is a different, newer product line with a
   different SANE backend; switching to it is a separate, bigger
   decision, not an implicit side effect of driver setup).
2. Extract the downloaded bundle — you should get `install.sh` plus
   `core/`, `data/`, and `plugins/` subdirectories, each with one `.deb`.
3. Plug in and power on the scanner (the script's final step performs
   a real test scan, not just detection, so it needs the device present).
4. Copy the bundle to the target machine and run:

   ```bash
   ./scripts/setup-graviscan-scanner-driver.sh /path/to/extracted/bundle
   ```

   **Before running**: this script uses `sudo` throughout — it installs
   system packages (including one fetched from Ubuntu's archive over
   the network), edits `/etc/sane.d/dll.conf`, and reloads udev rules.
   Read through it first if you want to know exactly what it touches
   before granting it root.

   The script's own last step already performs the real-scan
   verification described below — you shouldn't need to run this
   manually, but if you want to re-check independently later:

   ```bash
   scanimage -d 'epkowa:interpreter:BUS:DEVICE' --resolution 400 --format=tiff > test.tiff
   file test.tiff   # should report a valid TIFF image
   ```

   (Get the exact device string from `scanimage -L` — see
   [Noisy output](#noisy-output-from-network-scanner-backends) below.)

## What the script does, and why

### 1. Install iscan via Epson's own `install.sh`

Modern `iscan` (2.30.6-1, released after the `libsane` rename) already
declares its dependency as `libsane (>= 1.0.11-3) | libsane1` — an
OR-alternative that's satisfied by the renamed package. No
`--ignore-depends` needed for this one; it was simply a matter of
using a current build. (This is documented as the "cheapest, unverified"
fix candidate in issue #226 — confirmed here.)

### 2. Fix libxml2 — a two-level problem

Separately, Ubuntu 26.04 renamed `libxml2` to `libxml2-16` (this did
**not** happen in 24.04, which still ships plain `libxml2` — the
libsane and libxml2 renames landed two releases apart). Unlike
`libsane`, `iscan`'s dependency on `libxml2` has **no** OR-alternative,
so this still needs an explicit fix. But it's not one problem — it's
two, at different layers:

- **Package metadata**: `apt`/`dpkg` won't resolve `Depends: libxml2`
  against `libxml2-16` — nothing on the system is literally named
  `libxml2` anymore, so installation fails outright.
- **Runtime linking**: even once installation succeeds, the `epkowa`
  backend binary (`libsane-epkowa.so.1`) is dynamically linked against
  the old ABI's soname (`libxml2.so.2`). `libxml2-16` provides a
  genuinely different, incompatible ABI (that's _why_ the soname was
  bumped) — it does not provide `.so.2`, so `epkowa` fails to `dlopen`
  even if the package-level dependency is satisfied by some other
  means (e.g. a dummy `equivs` stub).

The script installs the **real** old `libxml2` build from Ubuntu's own
archive — specifically a version still shipping the `.so.2` ABI
(`2.12.7+dfsg+really2.9.14`, a security-patched rebuild of the old 2.9.x
codebase under a newer version string) — which solves both problems at
once: it satisfies the dependency by package name, and it provides the
genuine, ABI-compatible library `epkowa` actually needs. This is
different from (and better than) papering over the dependency with a
fake `equivs` package, which only fixes the metadata half and leaves
`epkowa` unable to load at all.

Because `libxml2` (old) and `libxml2-16` (current) use different
sonames and file paths, they coexist on disk without conflict — only
`epkowa` resolves against the old one; everything else on the system
keeps using `libxml2-16`.

The script downloads this over HTTPS and verifies it against a pinned
SHA256 checksum before installing it with `sudo dpkg -i` — a package
fetched from the network and installed as root should be verified,
not installed blind. **Maintenance note**: this is a pinned,
point-in-time archive artifact. If Ubuntu ever removes it from the
pool (old package versions do eventually get pruned), the script will
fail its checksum/fetch and need a new URL + checksum — see the
comment above `OLD_LIBXML2_URL` in the script, and the troubleshooting
entry below.

### 3. Verify apt is still consistent

`apt-get check` should report no errors after every step. This is the
actual point of doing this properly — if this ever fails, stop and
investigate before continuing; something has regressed to the same
broken state issue #226 describes.

### 4. Enable epkowa in SANE's backend list

Installing the backend library doesn't automatically enable it —
`/etc/sane.d/dll.conf` lists which backends SANE actually tries to
load, and a fresh Ubuntu install's `dll.conf` doesn't include
`epkowa` (it's an Epson-specific, non-free backend, not part of the
standard `sane-backends` package). Without this, `scanimage` silently
never attempts to load `epkowa` at all — no error, just no device.

### 5. Re-apply udev rules to already-connected devices

If the scanner was already plugged in before `iscan`'s udev rule
(`60-iscan.rules`) existed, the device node keeps its original
`root:root` permissions until something re-triggers udev. Unplugging
and replugging the scanner has the same effect as
`udevadm control --reload-rules && udevadm trigger`, if you'd rather do
that physically.

## Noisy output from network-scanner backends

`scanimage -L` also probes `escl`/`airscan`/`hpaio` (network scanner
discovery backends), which may print large amounts of unrelated HTML
to **stdout** if there are other network-attached scanners/printers
reachable on the same LAN (observed with an HP color laser MFP and a
Brother DCP-L2640DW during setup — appears to be a bug in how those
backends handle certain HTTP responses during discovery, unrelated to
this driver). This is noisy but harmless; the actual epkowa result is a
plain line near the end of the output:

```
device `epkowa:interpreter:001:004' is a Epson Perfection V600 Photo flatbed scanner
```

Filter for the epson result specifically if this bothers you:

```bash
scanimage -L 2>/dev/null | grep -oE "device .epkowa:interpreter[^ ]*. is a [^\`]*"
```

## Troubleshooting

### `iscan : Depends: libsane (>= 1.0.11-3) but it is not installable`

You're using an old `iscan` build (pre-2.30.6ish) that lacks the
`| libsane1` OR-alternative. Download a current version instead —
Epson's own download portal serves the latest by default.

### `curl: (22) The requested URL returned error: 404` on the libxml2 download

The pinned old-`libxml2` build has been removed from Ubuntu's archive.
Browse https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/ for
another build whose version string contains `+really2.9.x` (or a plain
`2.9.x` release) — any of them ship the same `.so.2` ABI. Update both
`OLD_LIBXML2_URL` and `OLD_LIBXML2_SHA256` (compute the latter with
`sha256sum` on the downloaded file) in the script, and update the
version numbers referenced in this doc.

### Scanner not detected after running the script

1. Confirm it's physically detected at the USB level first (separate
   from SANE/epkowa):
   ```bash
   sane-find-scanner -v -v 2>&1 | grep -i epson
   ```
   If this doesn't find it, it's a connectivity/power/USB issue, not a
   driver issue.
2. Check `dll.conf` actually has `epkowa`:
   `grep epkowa /etc/sane.d/dll.conf`
3. Check the backend actually loads (no missing library):
   `LC_ALL=C ldd /usr/lib/x86_64-linux-gnu/sane/libsane-epkowa.so.1 | grep "not found"`
   (`LC_ALL=C` keeps the "not found" phrasing consistent regardless of
   locale.) Any output here means a still-missing dependency — re-run
   the script, or track down the specific missing `.so` the same way
   this doc tracked down `libxml2.so.2`.

### Applying this to the real production rig

`graviscan-ms-7c56` currently has `iscan` installed via the old
`--ignore-depends` workaround (per issue #226), which means its `apt`
is already in the broken state this doc avoids. This script is written
for a **fresh** install; cleanly un-breaking an already-broken rig
(removing the force-installed packages, then following this procedure)
is a separate, higher-stakes exercise on real production hardware and
should be planned deliberately rather than run as-is — see issue #226
for status.

## Related Documentation

- [GraviScan Linux Deployment](GRAVISCAN_LINUX_DEPLOYMENT.md) — the
  packaged app's own libusb-filter/LD_PRELOAD wiring, deb-vs-rpm choice,
  and systemd/permissions (distinct from this doc's driver-setup focus)
- [Scanner Testing Guide](SCANNER_TESTING.md) — CylinderScan scanner
  (Basler camera + NI-DAQ), a different subsystem from GraviScan
- [Camera Testing Guide](CAMERA_TESTING.md)
- Issue #226 — original problem report and candidate fixes
