<callout icon="💡" color="gray_background">
Last updated: 2026-05-26 — verified against bloom-graviscan v0.1.0 on branch fix/v600-wedge-followups@bb97fc3. If something on this page doesn't match what you see in the app, the app probably got updated after this doc was last verified. Ping Benfica/Elizabeth in #topic-graviscan-alerts.
</callout>

# 0. Before you start (pre-flight checklist)

| # | Check | How to verify | If fails |
|---|---|---|---|
| 1 | All 5 scanners powered on, LED steady | Walk past the rig; each scanner's status light is steady | Power it on, wait 10 sec, then check Configure Scanner page |
| 2 | App launched from the desktop icon (not a terminal) | Single click on the desktop shortcut; window opens within ~5 sec | Close + relaunch via icon |
| 3 | Free disc space ≥ 50 GB on `/data` | Open Terminal: `df -h /data` | If `/data` doesn't exist: ping engineering. If <50 GB: ping engineering before starting |
| 4 | `#topic-graviscan-alerts` channel open in Slack | Slack search "topic-graviscan-alerts" → public channel, anyone can join | Without this, wedge alerts go unseen → silent data loss |
| 5 | Physical scanner tape labels match UI Scanner numbering | Glance at each physical scanner's tape label, cross-reference with the UI | If they don't match: STOP and ping Benfica/Elizabeth |

# 1. Open Bloom Desktop

<callout icon="📢" color="yellow_background">
Verify the "Mock Mode" banner is NOT visible after launch. If it appears, close the app and relaunch via the desktop icon — not from a terminal.
</callout>

- Click the desktop icon
- Verify the "Mock Mode" banner is NOT visible
- Wait ~30 sec for all 5 scanners to come up

<!-- SCREENSHOT 1: Bloom Desktop app icon on the desktop; ALT: The Bloom Desktop application icon as it appears on the Ubuntu desktop -->

<!-- SCREENSHOT 2: Bloom Desktop main window after launch, all 5 scanners loading; ALT: Bloom Desktop main window shown immediately after launch, displaying the scanner status panel with all 5 scanners initializing -->

# 2. Verify scanners

- Navigate to the Configure Scanner page → all 5 scanners should appear green
- If any scanner is red, follow this ordered recovery sequence:
  1. Click "Reset USB" — wait ~10 sec — re-check
  2. Close the app and reopen via desktop icon
  3. Power-cycle the affected physical scanner
  4. Ping Benfica/Elizabeth in `#topic-graviscan-alerts`

<callout icon="⚠️" color="orange_background">
Do NOT unplug a scanner and move it to a different USB port. Moving a scanner to a new port creates a new database row with no display name, breaking "Scanner 1" naming continuity and splitting historical scan data across two records. See issue #203.
</callout>

<!-- SCREENSHOT 3: Configure Scanner page with all 5 scanners showing green status; ALT: The Configure Scanner page in Bloom Desktop showing all five scanners with green status indicators -->

<!-- SCREENSHOT 4: Configure Scanner page with one scanner showing red status and the Reset USB button visible; ALT: The Configure Scanner page showing one scanner in a red/error state with the Reset USB button highlighted -->

# 3. (one-time-per-phenotyper) Add yourself as Phenotyper

- Open the Phenotypers admin page and add yourself if your name is not already in the dropdown
- Return to the main app — your name will now appear in the Phenotyper dropdown

<!-- MENTION_PAGE: Phenotypers -->

# 4. (one-time-per-scientist) Add yourself as Scientist

- Open the Scientists admin page and add yourself if your name is not already in the dropdown
- Return to the main app — your name will now appear in the Scientist dropdown when creating an Experiment

<!-- MENTION_PAGE: Scientists -->

# 5. (per experiment) Add your Experiment

<callout icon="📢" color="yellow_background">
Experiment names must be unique. Use the naming convention `<Gene/Treatment>_<Month>_<Year>` (e.g., `Col0_May_2026`). Data with the same experiment name is aggregated in Bloom — a duplicate name will mix your data with a previous experiment.
</callout>

- Visit the Experiments page → click New Experiment
- Naming convention: `<Gene/Treatment>_<Month>_<Year>` — must be unique
- Pick species, scientist (yourself)

<!-- MENTION_PAGE: Experiments -->

# 6. (when you have accessions) Add Accessions to the Experiment

<callout icon="📢" color="yellow_background">
The accessions upload file MUST be Excel (.xlsx or .xls), 15 MB max. There is no CSV path — CSV files will be rejected.
</callout>

<callout icon="💡" color="gray_background">
A sample accessions file is available in the repo at `tests/fixtures/graviscan/accessions-sample.xlsx` and is also uploaded to the shared Box folder. Download it as a template before building your own file.
</callout>

- Click "Upload Accessions" on the Experiment row
- The file must be Excel (.xlsx or .xls), 15 MB max — **no CSV path exists**
- 7 columns required (header row required), 6 required + 1 optional:

| Column | Type | Example | Notes |
|---|---|---|---|
| `plate_id` | string | `PLATE_001` | One Accession per plate_id |
| `plate_section_id` | string | `S1` | Section within plate |
| `plant_qr` | string | `PLANT-001-A` | Unique within plate |
| `accession` | string | `Col-0` | Consistent for same plate_id |
| `transplant_date` | date | `2025-06-15` | YYYY-MM-DD, year 1900-2100 |
| `medium` | string | `1/2 MS` | Growth medium |
| `custom_note` | string | `replant` | **OPTIONAL** — only optional col |

- Common errors:
  - Mixed accession within one plate_id → upload blocked
  - Duplicate (plate_id, plant_qr) → upload blocked
  - Missing required column → row silently dropped

<!-- SCREENSHOT 6: Upload Accessions modal with the column mapping UI visible; ALT: The Upload Accessions modal dialog in Bloom Desktop showing the file picker and column mapping interface -->

# 7. Set up your scan

<callout icon="📢" color="yellow_background">
Plate placement is critical. Place plates physically as shown in the UI assignment. The QR code must be visible from the scanner side (face down on the flatbed). QR detection is post-scan and is NOT 100% accurate — wrong placement requires database cleanup. See the Brady QR Code page linked below for QR-code preparation.
</callout>

<callout icon="🔬" color="blue_background">
Test Scan — strongly recommended before long-running experiments. Run a single Test Scan per scanner and inspect the resulting image in Browse. Adjust placement if anything is off. Repeat until all 4 plates per scanner are clearly visible.
</callout>

- Pick experiment / phenotyper / wave
- Assign plate barcodes to scanners
- Place plates physically as shown in the UI assignment
  - QR code visible from the scanner side (face down on the flatbed)
  - QR detection is post-scan and is NOT 100% accurate
  - Wrong placement requires DB cleanup we'd rather avoid
- For QR-code prep: see <!-- MENTION_PAGE: Making QR Codes with Brady Label Maker -->

<!-- SCREENSHOT 7: Physical photo of plates placed correctly on a flatbed scanner, QR codes facing down; ALT: A photograph of Petri plates placed on a flatbed scanner with QR code labels facing down toward the scan surface -->

<!-- SCREENSHOT 5: New Experiment form in Bloom Desktop; ALT: The New Experiment creation form in Bloom Desktop showing the experiment name field, species picker, and scientist dropdown -->

# 8. Choose scan mode

<callout icon="📢" color="yellow_background">
If the AMBER cadence-warning banner appears: your interval is too short for the predicted cycle time. Increase the interval OR lower the DPI before starting — do not dismiss the warning and proceed.
</callout>

- **Single-scan:** one cycle, then done
- **Continuous:** cycles N times with interval (typical for time-lapse experiments)

<!-- SCREENSHOT 8: Bloom Desktop scan configuration screen with the amber cadence-warning banner visible; ALT: The scan setup screen in Bloom Desktop showing the amber cadence warning banner indicating the scan interval is shorter than the predicted cycle time -->

# 9. Start the scan + monitor

<callout icon="📢" color="yellow_background">
Wedge alerts come via Slack only — the app does NOT show wedge banners in the UI. Check `#topic-graviscan-alerts` in Slack at LEAST every 30 min during long runs. A missed alert means missed data.
</callout>

- Click Start Scan
- Watch the progress panel + `#topic-graviscan-alerts` in Slack
- Check Slack at LEAST every 30 min during long runs
- Wedge alerts come via Slack only — the app does NOT show wedge banners in the UI

# 10. Browse + Upload

<callout icon="🚨" color="red_background">
DO NOT manually move, rename, or delete files in the scan output folder. The database stores absolute paths; touching them breaks Bloom upload, Box backup, and reprocessing. If you need to free space, ping engineering first.
</callout>

<callout icon="⚠️" color="orange_background">
Don't start another scan while upload is running. Wait for the upload to complete before launching a new scan session.
</callout>

- Browse Scans tab shows saved files
- Files land in `/data/bloom/graviscan/<experiment>_<timestamp>/` (after one-time Machine Config redirect to the 14.6 TB `/data` partition); fallback: `~/.bloom/graviscan/<experiment>_<timestamp>/`
- Upload to Bloom runs automatically after scan completes
- Box backup runs after Bloom upload; data also at [Box folder URL — operator-provided; placeholder until link is shared]

<!-- SCREENSHOT 9: Browse Scans tab in Bloom Desktop showing a list of saved scan files; ALT: The Browse Scans tab in Bloom Desktop displaying a list of completed scan sessions with file paths and timestamps -->

# 11. 🚨 Wedge alerts — what to do

<callout icon="⚠️" color="orange_background">
READ THIS FIRST: a wedge alert means data loss is happening NOW. Every minute you wait without intervening is more missing data for the wedged scanner.
</callout>

**Why time-lapse wedges are unrecoverable:**

- Plants grow continuously during the experiment
- Missed cycles cannot be "redone" — the plant is in a different state every minute
- Whatever cycles the wedged scanner is missing are gone forever for that plant

**What the app does NOT do (today, by design — see follow-up issue):**

- Pause scanning to wait for you
- Auto-retry the wedged scanner
- Show a banner in the UI
- Record the wedge in the database (only the Slack POST + a log line)
- Offer a "resume" or "skip this plate" button

**Your options — both involve some data loss:**

- **Option A — Continue and accept gaps on the wedged scanner:**
  - Other 4 scanners keep working normally
  - The wedged scanner produces NO images / NO database rows for every cycle until physical power-cycle
  - The longer you wait to intervene, the bigger the gap for that scanner

- **Option B — Cancel and power-cycle:**
  - Click "Cancel Scan" — stops ALL scanners
  - Power-cycle the wedged physical scanner (off, wait 10 sec, on)
  - Wait for it to come back green in Configure Scanner
  - Restart the experiment
  - COST: ALL 5 scanners lose data for the ~5-10 min cancel/restart window
  - BENEFIT: from the restart on, you're back to full 5-scanner data

**Tradeoff rule of thumb:** if you can power-cycle within ~10 min of the alert AND the experiment is long (>1 hour remaining), Option B usually loses less data than Option A.

**Either way: note the wedge in your experiment notes so you remember the gap.**

<callout icon="🚨" color="red_background">
Escalate — ping Benfica/Elizabeth in `#topic-graviscan-alerts` — when any of the following occur:

- Same scanner wedges 2× in 1 hour
- Multiple scanners wedge in the same session
- Wedge alert arrives but the UI still shows everything green
- No alert at all but you suspect a scanner is wedging (Slack env may be broken)
</callout>

Background context: see <!-- MENTION_PAGE: V600 USB Wedge Investigation Summary -->

<!-- SCREENSHOT 10: Slack #topic-graviscan-alerts channel showing a synthetic wedge alert message from the PR #237 rig validation test (2026-05-22); ALT: The Slack #topic-graviscan-alerts channel displaying an example wedge alert notification message -->

---

## Changelog

| Date | Change | Author |
|---|---|---|
| 2026-05-26 | Initial draft — verified against bloom-graviscan v0.1.0 on fix/v600-wedge-followups@bb97fc3 | Benfica / Elizabeth |
| **TBD** | When issue #203 (scanner port-move display_name bug) ships: remove Section 2 port-move warning and update to reflect fixed behavior | — |
| **TBD** | When issue #243 (wedge response / UI affordance) ships: update Section 11 to reflect new pause/retry/skip options | — |
| **TBD** | When env-config UI banner issue ships: add note to Section 9 that operators can self-check Slack + LIBUSB_ENDPOINT_RECOVERY status in the app | — |
| **TBD** | When accessions sample file is uploaded to Box: replace Section 6 placeholder URL with real Box link | — |

---

Maintained by: Benfica + Elizabeth (Bloom Subgroup). To suggest a change: ping in `#topic-graviscan-alerts`, or open an issue on the bloom-desktop GitHub repo.
