# GraviScan operator user manual — design

**Status:** approved by user 2026-05-26; ready for implementation planning
**Author:** Claude (this session, via `superpowers:brainstorming`)
**Source:** Notion + repo investigation + 4 parallel subagent reports during PR #237 rig validation walk
**Implementation pre-reqs:** see "Follow-up actions before / alongside authoring" near the end

## 1. Goal

Produce a concise, operator-facing user manual for the **GraviScan** workflow in `bloom-graviscan`, published as a new Notion page sibling to the existing cylinder-scanner doc.

The target reader is a plant scientist who runs scans daily and needs:

1. A ~10-minute happy-path walkthrough they can follow front-to-back the first time (~1700-word body, single page)
2. A reference they can skim later for specific steps
3. Honest guardrails about the failure modes (especially V600 wedges, scanner-port stability, and the irreversible nature of time-lapse data loss)

This doc is NOT for engineers, deploy automation, or new-team onboarding to bloom-desktop architecture — those topics live elsewhere.

## 2. Placement

**Notion location:** the existing "Protocols" page (id `1144a67a766781ae9f1fd32fdb47437d`) under the Engineering Wiki database hierarchy. The new page is a sibling of the existing **📜 Bloom Desktop** cylinder doc, which lives there alongside ~12 other operator protocols (RADICYL Calibration, SLEAP Labeling, rclone, robocopy, Brady Label Maker, CLI guides, Cylinder QC).

```
Engineering Wiki (database)
└── ⚙️ Protocols page
     ├── ... ~12 existing operator protocols
     ├── 📜 Bloom Desktop                     ← cylinder operator manual (existing)
     ├── 🪴 Bloom Desktop — GraviScan          ← NEW (this doc)
     └── Making QR Codes with Brady Label Maker
```

**Notion title:** `🪴 Bloom Desktop — GraviScan`

**Cross-links from the new doc (using `<mention-page>` like the cylinder doc):**

- Phenotypers / Scientists / Experiments admin pages (linked inline in Sections 3, 4, 5)
- Making QR Codes with Brady Label Maker (linked in Section 7, plate placement)
- V600 USB Wedge Investigation Summary (linked in Section 11)

**Cross-links the doc deliberately does NOT include:**

- The "Add script with accession info uploader" page — that's an engineering task, not operator guidance
- Literature Review, Hardware Scaling Discussion, Setup Summary for Team — engineering background
- Anywhere outside the Bloom-Desktop section of the Wiki

**Notion structure cleanup is out of scope.** The user noted the broader Notion is messy with ~9 overlapping GraviScan pages; this brainstorm explicitly did not address that cleanup. It's filed as a separate follow-up.

## 3. Approach

**Approach A — concise operator quickstart**, expanded into a **hub structure** to absorb the scope additions during brainstorming.

The user's initial scope was "happy path only" (Approach A, ~500-800 words). During discussion they added: first-time setup (phenotyper / scientist / experiment / accessions), troubleshooting (wedge response), plate-placement protocol, Test Scan verification, disc-space + Slack-channel guidance.

Final shape: ~1700-word single-page manual, **all critical content inline**, with `<mention-page>` cross-links only to existing simple admin pages and the Brady QR code prep doc. No new sub-pages.

Rejected alternatives:

- **Approach B (comprehensive ~2000 words inline):** would silently expand into engineering content; too long for a 5-minute read
- **Approach C (main hub + N sub-pages):** higher maintenance overhead; harder to print/share as a single artifact; risk of dead links

## 4. Document structure — sections

The body of the manual is a 12-section linear walkthrough (Section 0 is the pre-flight checklist, Sections 1-11 are the workflow).

### Section 0 — Before you start (pre-flight checklist, 5 items)

| # | Check | How to verify | If fails |
|---|---|---|---|
| 1 | All 5 scanners powered on, LED steady | Walk past the rig; each scanner's status light is steady | Power it on, wait 10 sec, then check Configure Scanner page |
| 2 | App launched from the desktop icon (not a terminal) | Single click on the desktop shortcut; window opens within ~5 sec | Close + relaunch via icon |
| 3 | Free disc space ≥ 50 GB on `/data` | Open Terminal: `df -h /data` | If `/data` doesn't exist: ping engineering. If <50 GB: ping engineering before starting |
| 4 | `#topic-graviscan-alerts` channel open in Slack | Slack search "topic-graviscan-alerts" → public channel, anyone can join | Without this, wedge alerts go unseen → silent data loss |
| 5 | Physical scanner tape labels match UI Scanner numbering | Glance at each physical scanner's tape label, cross-reference with the UI | If they don't match: STOP and ping Benfica/Elizabeth |

### Section 1 — Open Bloom Desktop

- Click the desktop icon
- Verify the "Mock Mode" banner is NOT visible
- Wait ~30 sec for all 5 scanners to come up
- Screenshot 1: app icon. Screenshot 2: main window.

### Section 2 — Verify scanners

- Configure Scanner page → all 5 should be green
- If any red, ordered recovery:
  1. Click "Reset USB" — wait ~10 sec — re-check
  2. Close the app and reopen via desktop icon
  3. Power-cycle the affected physical scanner
  4. Ping Benfica/Elizabeth in `#topic-graviscan-alerts`
- ⚠️ Do NOT unplug + move a scanner to a different USB port (see #203, scanner-identity bug)
- Screenshot 3: all green. Screenshot 4: one red + Reset USB button visible.

### Section 3 — (one-time-per-phenotyper) Add yourself as Phenotyper

Brief inline steps; mention-page to the Phenotypers admin page.

### Section 4 — (one-time-per-scientist) Add yourself as Scientist

Brief inline steps; mention-page to the Scientists admin page.

### Section 5 — (per experiment) Add your Experiment

- Visit Experiments page → New Experiment
- Naming convention: `<Gene/Treatment>_<Month>_<Year>` — must be unique
- Pick species, scientist (yourself)
- Screenshot 5: New Experiment form.

### Section 6 — (when you have accessions) Add Accessions to the Experiment

- Click "Upload Accessions" on the Experiment row
- 📢 File MUST be Excel (.xlsx or .xls), 15 MB max — **no CSV path exists**
- 7 columns (header row required), 6 required, 1 optional:

| Column | Type | Example | Notes |
|---|---|---|---|
| `plate_id` | string | `PLATE_001` | One Accession per plate_id |
| `plate_section_id` | string | `S1` | Section within plate |
| `plant_qr` | string | `PLANT-001-A` | Unique within plate |
| `accession` | string | `Col-0` | Consistent for same plate_id |
| `transplant_date` | date | `2025-06-15` | YYYY-MM-DD, year 1900-2100 |
| `medium` | string | `1/2 MS` | Growth medium |
| `custom_note` | string | `replant` | **OPTIONAL** — only optional col |

- Link to sample file (Box) — sample committed to repo as `tests/fixtures/graviscan/accessions-sample.xlsx`; same file uploaded to a shared Box folder; manual links the Box URL
- Common errors:
  - Mixed accession within one plate_id → upload blocked
  - Duplicate (plate_id, plant_qr) → upload blocked
  - Missing required column → row silently dropped
- Screenshot 6: Upload Accessions modal + column mapping UI.

### Section 7 — Set up your scan

- Pick experiment / phenotyper / wave
- Assign plate barcodes to scanners
- 📢 PLATE PLACEMENT — critical:
  - Place plates physically as shown in the UI assignment
  - QR code visible from the scanner side (face down on the flatbed)
  - QR detection is post-scan and is NOT 100% accurate
  - Wrong placement requires DB cleanup we'd rather avoid
  - For QR-code prep: see "Making QR Codes with Brady Label Maker"
- 🔬 Test Scan — strongly recommended before long-running experiments:
  - Run a single Test Scan per scanner
  - Inspect the resulting image in Browse — adjust placement if anything is off
  - Repeat until all 4 plates per scanner are clearly visible
- Screenshot 7: plate placement photo (physical).

### Section 8 — Choose scan mode

- Single-scan: one cycle, then done
- Continuous: cycles N times with interval (typical for time-lapse experiments)
- 📢 If the AMBER cadence-warning banner appears: your interval is too short for the predicted cycle time; increase interval OR lower DPI
- Screenshot 8: cadence-warning banner visible.

### Section 9 — Start the scan + monitor

- Click Start Scan
- Watch the progress panel + `#topic-graviscan-alerts` in Slack
- Check Slack at LEAST every 30 min during long runs
- Wedge alerts come via Slack only — the app does NOT show wedge banners in the UI

### Section 10 — Browse + Upload

- Browse Scans tab shows saved files
- Files land in `/data/bloom/graviscan/<experiment>_<timestamp>/` (after one-time Machine Config redirect to the 14.6 TB `/data` partition); fallback: `~/.bloom/graviscan/<experiment>_<timestamp>/`
- 🚨 DO NOT manually move, rename, or delete files in this folder. The database stores absolute paths; touching them breaks Bloom upload + Box backup + reprocessing
- Upload to Bloom runs automatically after scan completes
- Box backup runs after Bloom upload; data also at [Box folder URL — operator-provided; placeholder in spec until link is shared]
- ⚠️ Don't start another scan while upload is running
- Screenshot 9: Browse Scans showing saved files.

### Section 11 — 🚨 Wedge alerts — what to do

⚠️ READ THIS FIRST: a wedge alert means data loss is happening NOW.

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

Escalate (ping Benfica/Elizabeth in `#topic-graviscan-alerts`) when:

- Same scanner wedges 2× in 1 hour
- Multiple scanners wedge in the same session
- Wedge alert arrives but the UI still shows everything green
- No alert at all but you suspect a scanner is wedging (Slack env may be broken)

Background context: see "V600 USB Wedge Investigation Summary"

- Screenshot 10: Slack wedge alert example (use the synthetic test message already in `#topic-graviscan-alerts` from 2026-05-22).

## 5. Guardrails registry

Pre-flight checklist (5 items, see Section 4 above) + 13 inline guardrails throughout the body. Each guardrail has an explicit emoji marker:

- 🚨 critical (2 callouts) — irreversible data loss: file-touching warning (Section 10), escalation criteria (Section 11)
- ⚠️ warning (3 callouts) — could cause silent regression: scanner-port-move (Section 2), concurrent scan during upload (Section 10), wedge READ THIS FIRST header (Section 11)
- 📢 important (6 callouts) — easy to miss, costs redo work: mock mode (Section 1), unique experiment name (Section 5), file format (Section 6), plate placement (Section 7), cadence warning (Section 8), slack monitoring (Section 9)
- 🔬 verification (1 callout) — Test Scan before long runs (Section 7)
- 💡 tip (1 callout) — sample file link (Section 6)

Exact wording for each callout is specified in Section 4 above.

## 6. Screenshots — inventory + acquisition

10 must-have screenshots (numbered 1-10 in Section 4 above), captured by the operator at the rig in one ~20-30 min session. The spec embeds `<SCREENSHOT N: brief description; ALT: ...>` markers at each location; the operator pastes the captured image into the marker when authoring the Notion page.

Screenshots 1-6, 8-10 are app-UI screenshots (`gnome-screenshot` or Print Screen). Screenshot 7 is a phone photo of physical plate placement.

For Screenshot 4 (one red scanner state) — the operator either reproduces the state intentionally (unplug Scanner 1 briefly) or skips the screenshot and uses text only. For Screenshot 10 (Slack wedge alert) — use the synthetic test message already present in `#topic-graviscan-alerts` from PR #237 rig validation.

## 7. Maintenance + version tagging

**Header callout (top of doc):**

```
💡 Last updated: <date> — verified against bloom-graviscan v<X.Y.Z> on
   branch <branch>@<commit>. If something on this page doesn't match
   what you see in the app, ping Benfica/Elizabeth in #topic-graviscan-alerts.
```

**Footer changelog (bottom of doc):** most-recent-first, capped at 5-10 entries. Older history relies on Notion's built-in page-history. Includes forward-looking `**TBD**` entries that double as a roadmap (e.g., "when #243 ships, remove the port-move warning").

**Ownership:** "Maintained by Benfica + Elizabeth (Bloom Subgroup). To suggest a change: ping in `#topic-graviscan-alerts`, or open an issue on the bloom-desktop GitHub repo."

**Re-verification triggers** (spec-internal, not in operator manual):

- New `bloom-graviscan` .deb deployed → re-walk pre-flight + Sections 1-3
- Follow-up issue resolves (#203, #243, future wedge / env-banner) → update relevant TBD entry to dated entry + edit affected sections
- Hardware change at rig → update Section 2 + pre-flight #5
- Slack channel rename → find/replace
- Box URL change → update Section 10 link

**Why not heavier process:** internal audience (~5-10 readers), cylinder doc has no version info and that's worked, heavier process discourages updates, Notion's history covers audit trail.

## 8. Subagent findings preserved

Four parallel subagent investigations during this brainstorm informed the spec. Summaries preserved here so future maintainers don't have to re-discover them.

**Subagent A — 10 TB partition:** confirmed `/dev/sda1` is 14.6 TB mounted at `/data` (43 GB used, 14 TB free). The app has first-class `scans_dir` config (settable via Machine Configuration UI, persisted as `SCANS_DIR=...` in `~/.bloom/.env`). One-time setup: `sudo mkdir -p /data/bloom && sudo chown graviscan:graviscan /data/bloom`, then set Scans Dir to `/data/bloom/graviscan` in the app. DB stays at `~/.bloom`.

**Subagent B — Accessions file format:** Excel-only (.xlsx/.xls), 15 MB max. 6 required + 1 optional column. Column-mapping UI lets operator pick which header maps to each field, so column names don't have to match exactly. No CSV path exists. Cylinder-doc's `plant_id | genotype | treatment | position` schema is OUTDATED for GraviScan. Two existing files on rig already match GraviScan format; one will be committed to repo as the canonical sample fixture.

**Subagent C — Scanner replug + reconfig behavior:** five scenarios analyzed (mid-scan unplug, port-move, Reset USB, Detect Scanners, Remove button). The critical finding is **scenario B (port-move): `upsertScannerRow` has no `display_name` fallback, so moving a scanner to a different USB port creates a NEW DB row with `display_name=null`, and the old row gets disabled by `disableStaleScannerRows`. "Scanner 1" naming continuity breaks and historical scan data splits across two `GraviScanner` rows.** This is the basis for the Section 2 warning and is duplicate of existing issue #203 — a comment is added to #203 with code-line evidence rather than filing a new issue.

**Subagent D — Post-wedge behavior:** wedge alert is fire-and-forget. Continuous scan does NOT pause, retry, or auto-respawn. The wedged Python worker stays alive but every subsequent cycle re-hits the wedge. **No UI affordance for resume/skip/retry**; only `cancel-scan` exists. Failed plate scans produce no file and no GraviScan DB row (so metadata integrity is safe — no orphans, no duplicates). The risk is **missing data** — wedged cycles are gaps that cannot be recovered for time-lapse experiments. This finding shapes the honest framing in Section 11 and is the basis for a new follow-up issue.

## 9. Follow-up actions (BEFORE / ALONGSIDE authoring)

These are pre-requisites or parallel actions that the writing-plans skill should treat as upstream dependencies, not as deferred-forever items.

| # | Action | Blocking? |
|---|---|---|
| 1 | Set up 10 TB partition redirect: `sudo chown` on `/data/bloom`, then Machine Config UI step | Recommended before the manual ships (so Section 0 #3 and Section 10 use the simpler text without conditional language) |
| 2 | Commit `/home/graviscan/Desktop/test-metadata-sample.xlsx` to repo as `tests/fixtures/graviscan/accessions-sample.xlsx` + upload to Box + capture Box URL | Blocking for Section 6 sample-file link |
| 3 | Add comment to issue #203 with Subagent C code-line evidence about the port-move display_name bug | Non-blocking; informational for the warning text |
| 4 | File new GitHub issue: "Wedge response gap — no UI affordance for resume / skip / retry; irreversible time-lapse data loss for affected plates" | Non-blocking; the manual's Section 11 references the gap honestly regardless |
| 5 | File new GitHub issue: "Env config UI banner — show Slack on/off + LIBUSB_ENDPOINT_RECOVERY on/off in the app so operators can self-detect misconfiguration" | Non-blocking |
| 6 | Capture the 10 screenshots at the rig | Blocking for final Notion publication; the spec uses placeholders until they're captured |
| 7 | Operator provides Box folder URL for backup link in Section 10 | Blocking for the Section 10 link; placeholder until provided |

## 10. Out-of-scope (intentionally not in this spec)

- Engineering-facing docs (architecture, build, deploy, debugging)
- Onboarding for new bloom-desktop developers
- Notion structure cleanup (~9 overlapping GraviScan pages — separate large task)
- A separate "Wedge Response Playbook" sub-page — folded into Section 11 as a single self-contained section instead
- Per-scenario admin docs (Add Phenotyper / Scientist / Experiment as standalone pages) — those are inline brief sections in the main manual
- Cylinder-scanner content (the existing 📜 Bloom Desktop doc covers that)

## 11. Open question for user review

The header callout's version tag will start at `v0.1.0` on branch `fix/v600-wedge-followups@bb97fc3` since that's what's currently running on the rig. When the future feature-by-feature redo session lands, the header changes to reflect whichever branch lands. **No semver discipline is enforced; the version line is informational, not contractual.**

If the user wants tighter semver / sign-off / required-review process, that's an explicit override in Section 7 ("heavier process" alternative listed during brainstorming was rejected).
