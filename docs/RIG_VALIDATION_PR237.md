# Rig Validation Checklist — PR #237 (V600 wedge follow-ups)

**Purpose:** validate the `fix/v600-wedge-followups` branch on the
production rig (`graviscan@graviscan-ms-7c56`) before using it for the
upcoming experiment. Completes the deferred items from PR #237's
"Rig validation (Task 12, 2026-05-22)" section.

**Date:** _________ **Operator:** _________
**Branch HEAD:** `fb53449` (or later) on `fix/v600-wedge-followups`
**Pre-validation context:** packaged app (`bloom-graviscan 0.1.0`,
`.deb` installed, launched from bash) was running PID 181158 at last
check. Synthetic injection of WedgeDetector + SlackNotifier already
validated end-to-end via tsx; this pass covers the deferred real-scan
+ libusb-filter-under-load + production-deploy steps.

---

## Tier 1 — Physical sanity (5-10 min, zero disruption)

- [ ] All 5 V600 scanners powered on, blue LED steady, USB cables seated
- [ ] HDMI dummy plug or real monitor attached (fixes RDP "Unknown
      monitor" error — see PR #237 conversation for details)
- [ ] Open `#topic-graviscan-alerts` in Slack — two test messages from
      2026-05-22 ~15:46 PDT should be visible (webhook reachability +
      synthetic wedge alert). If gone, channel may have been pruned;
      not blocking.
- [ ] Rotate `BLOOM_SCANNER_PASSWORD` (was `r00t`; leaked in earlier
      validation transcript). Use `Settings → Machine Config` in
      packaged app, or edit `~/.bloom/.env` directly.

**SSH-side checks (run from your laptop):**

```bash
ssh graviscan@graviscan-ms-7c56.tail461d0e.ts.net "
  pgrep -f /usr/lib/bloom-graviscan/bloom-graviscan && echo 'packaged app running';
  ls -lat ~/.bloom/logs/ 2>/dev/null | head -5;
  grep -c '^BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL=' ~/.bloom/.env;
  grep -c '^LIBUSB_ENDPOINT_RECOVERY=' ~/.bloom/.env;
"
```

- [ ] Both env-var grep counts return `1`
- [ ] No fresh error tracebacks in `~/.bloom/logs/`

**Decision:** if Tier 1 passes, proceed to Tier 2.

---

## Tier 2 — Complete deferred validation (30-45 min, brief pause)

**Pause window** — confirm no critical scan in progress, then stop
the packaged app:

```bash
ssh graviscan@graviscan-ms-7c56.tail461d0e.ts.net
# (now on the rig)
pgrep -f /usr/lib/bloom-graviscan/bloom-graviscan
pkill -f /usr/lib/bloom-graviscan/bloom-graviscan
sleep 5
pgrep -f bloom-graviscan || echo "all stopped"
```

- [ ] Packaged app cleanly stopped

**Launch the dev app from `.dev/`:**

```bash
cd /home/graviscan/.dev/bloom-desktop
git log -1 --oneline      # should show fb53449 or later on fix/v600-wedge-followups
export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh
mkdir -p /tmp/v600-validation
DISPLAY=:0 npm run dev 2>&1 | tee /tmp/v600-validation/dev-run.log
```

While the app boots (~30 s), watch `dev-run.log` in another SSH session:

```bash
tail -f /tmp/v600-validation/dev-run.log
```

- [ ] `[GraviScan] Slack webhook URL loaded from ~/.bloom/.env` appears
- [ ] `[GraviScan] LIBUSB_ENDPOINT_RECOVERY explicitly set to: true`
      appears
- [ ] Electron window opens on the rig's monitor (you need HDMI plug)
- [ ] No fatal errors in console

**In the dev app UI, configure a small scan:**

- [ ] Click **Configure Scanner** → **Detect** — at least 1 scanner
      should appear
- [ ] Resolution dropdown shows `1200 DPI` with label
      `(production, validated at 140×140 mm)` ← Copilot #18 verification
- [ ] Pick exactly **1 scanner**, **4-grid mode**, **1200 DPI**, **Save**

**Start the scan:**

- [ ] Go to **GraviScan** (Capture) page
- [ ] Pick an experiment, phenotyper, wave number
- [ ] Switch to **Continuous scan** mode
- [ ] Interval: **2 min**, Duration: **6 min** (3 cycles × 4 plates each)
- [ ] Click **Start Scan**

**Watch for libusb-filter init (~30 s after first plate starts):**

```bash
grep -hE '\[libusb-filter\]' /tmp/v600-validation/dev-run.log
```

- [ ] `[libusb-filter] endpoint recovery: on` appears (Task 12.5)
- [ ] No `FATAL: cannot find real libusb_*` errors

**Let the 6-minute scan complete.** While it runs:

- [ ] No wedge alerts appear in `#topic-graviscan-alerts` (healthy
      scans don't trigger the detector)
- [ ] GraviScan UI shows scan progress, no red banners
- [ ] After ~6 min: 12 plate images in
      `~/.bloom/data/<experiment>_<timestamp>/` (3 cycles × 4 plates)
- [ ] No errors in `dev-run.log`

**Toggle test (Copilot 12.9):** verify `LIBUSB_ENDPOINT_RECOVERY=false`
disables the wrapper. In a separate terminal:

```bash
cp ~/.bloom/.env ~/.bloom/.env.bak-tier2
sed -i 's/^LIBUSB_ENDPOINT_RECOVERY=true/LIBUSB_ENDPOINT_RECOVERY=false/' ~/.bloom/.env
# Ctrl-C in the dev-app terminal, then re-run:
DISPLAY=:0 npm run dev 2>&1 | tee /tmp/v600-validation/dev-run-toggle.log
```

- [ ] `[GraviScan] LIBUSB_ENDPOINT_RECOVERY explicitly set to: false`
      appears at startup
- [ ] First scan attempt logs `[libusb-filter] endpoint recovery: off`
      in scan_worker stderr

**Revert toggle + stop dev app:**

```bash
mv ~/.bloom/.env.bak-tier2 ~/.bloom/.env
# Ctrl-C the dev app
```

- [ ] `~/.bloom/.env` restored to `LIBUSB_ENDPOINT_RECOVERY=true`

**If a real wedge happens during Tier 2 (Task 12.10):**

- [ ] Screenshot the GraviScan UI showing the failed plate
- [ ] Screenshot the Slack message in `#topic-graviscan-alerts`
- [ ] Save `~/.bloom/logs/<latest>.log` and `/tmp/v600-validation/dev-run.log`
- [ ] Note the exact USB port, time, scanner display name
- [ ] Capture stderr around the failure window:
      `grep -B2 -A20 'scan-error' /tmp/v600-validation/dev-run.log | tail -100`

**Decision:** if Tier 2 passes, you've closed the deferred items.
You can stop here (and either restart the packaged app or proceed to
Tier 3 to deploy the branch as the new packaged app).

---

## Tier 3 — Deploy branch as new packaged app (30-60 min)

**Pre-flight backup of the current install:**

```bash
# Backup current .deb so you can roll back if needed
ssh graviscan@graviscan-ms-7c56.tail461d0e.ts.net
dpkg-deb -W /var/cache/apt/archives/bloom-graviscan*.deb 2>&1 | head -3 ||
  echo "no .deb in apt cache — use dpkg --get-selections + reinstall path"
# If no .deb in cache, save the running binary tree for emergency restore:
sudo tar czf /home/graviscan/bloom-graviscan-prev-install.tar.gz /usr/lib/bloom-graviscan
ls -la /home/graviscan/bloom-graviscan-prev-install.tar.gz
```

- [ ] Backup tarball created (`bloom-graviscan-prev-install.tar.gz`,
      ~200-500 MB expected)

**Build the new .deb from the branch:**

```bash
cd /home/graviscan/.dev/bloom-desktop
git status               # clean, on fix/v600-wedge-followups
git log -1 --oneline     # confirm HEAD
export NVM_DIR=$HOME/.nvm && . $NVM_DIR/nvm.sh
npm run make:graviscan:linux 2>&1 | tee /tmp/v600-validation/make.log
ls -la out/make/deb/x64/
```

- [ ] `make` exits 0 (5-10 min build time)
- [ ] `.deb` artifact appears at `out/make/deb/x64/bloom-graviscan_*.deb`
- [ ] No errors in `make.log` related to libusb-filter.so or native deps

**Install the new .deb (replaces /usr/lib/bloom-graviscan):**

```bash
sudo apt install --reinstall ./out/make/deb/x64/bloom-graviscan_*.deb
# Or: sudo dpkg -i ./out/make/deb/x64/bloom-graviscan_*.deb
```

- [ ] Install completes without errors
- [ ] `dpkg -l | grep bloom-graviscan` shows the new version
- [ ] `ls /usr/lib/bloom-graviscan/resources/libusb-filter.so 2>&1`
      shows the file exists (LD_PRELOAD shim packaged correctly)

**Launch the new packaged app:**

```bash
# In a graphical terminal on the rig (or via DISPLAY=:0):
DISPLAY=:0 bloom-graviscan &
# Or click the .desktop icon in the app launcher
sleep 5
pgrep -f /usr/lib/bloom-graviscan/bloom-graviscan
```

- [ ] Process running
- [ ] UI opens on the rig's screen
- [ ] In the UI: ConfigureScanner page detects scanners; resolution
      shows `1200 DPI (production, validated at 140×140 mm)`
- [ ] In stderr/journal: `[GraviScan] Slack webhook URL loaded from
      ~/.bloom/.env` + `[GraviScan] LIBUSB_ENDPOINT_RECOVERY explicitly
      set to: true`
- [ ] Quick 1-cycle scan (1 scanner, 4-plate, 1200 dpi) completes
      without errors

**Mark validation complete:**

- [ ] Update PR #237 body's "Rig validation" section noting Tier 1-3
      completion + date
- [ ] Commit any new evidence files from `/tmp/v600-validation/` if
      worth saving (or fetch them locally for archival)

---

## Rollback (if Tier 3 deploy fails or you hit a regression)

```bash
# Stop the broken new install
pkill -f /usr/lib/bloom-graviscan/bloom-graviscan
sleep 3

# Restore the previous install from the tarball:
sudo rm -rf /usr/lib/bloom-graviscan
sudo tar xzf /home/graviscan/bloom-graviscan-prev-install.tar.gz -C /

# Launch the restored version:
DISPLAY=:0 bloom-graviscan &
pgrep -f /usr/lib/bloom-graviscan/bloom-graviscan
```

If even rollback fails: `apt download bloom-graviscan` then
`sudo dpkg -i bloom-graviscan_*.deb`. The `dpkg` database still has
the package marked installed, so apt knows how to fetch a replacement.

---

## Evidence to capture for PR #237

| Source | Location |
|---|---|
| Tier 2 dev-run.log | `/tmp/v600-validation/dev-run.log` (libusb-filter init line + scan completion) |
| Tier 2 toggle log | `/tmp/v600-validation/dev-run-toggle.log` (recovery=false branch) |
| Tier 3 make.log | `/tmp/v600-validation/make.log` (build artifact) |
| Slack screenshot | `#topic-graviscan-alerts` showing only test messages (no production wedges) OR a real wedge captured during validation |
| GraviScan UI screenshot | Configure Scanner with 1200 DPI label visible; GraviScan page mid-scan |

`scp` them back to your laptop:
```bash
scp -r graviscan@graviscan-ms-7c56.tail461d0e.ts.net:/tmp/v600-validation /tmp/
```

Then update PR #237's body via `gh pr edit 237 --body-file <updated>.md`
or paste evidence excerpts as a PR comment.
