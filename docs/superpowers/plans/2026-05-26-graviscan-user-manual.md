# GraviScan Operator User Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an operator-facing GraviScan user manual as a new Notion page (sibling to the existing cylinder-scanner doc), plus commit a canonical accessions sample fixture to the repo, plus file the 2 follow-up GitHub issues identified during the spec brainstorm.

**Architecture:** Three parallel workstreams. (A) **Repo + GitHub admin** — fixture commit, issue comment on #203, two new issues. Pure Claude tasks. (B) **Operator-side pre-requisites** — partition setup, Box upload, screenshot capture. User tasks at the rig. (C) **Notion page authoring** — draft full Markdown body in repo first, then create the Notion page via MCP API, then user adds screenshots and Box URL. Claude does the drafting + Notion API calls; user does the picture-side work.

**Tech Stack:** Notion API via `mcp__claude_ai_Notion__*` MCP tools; GitHub via `gh` CLI; git for repo commits; the spec at `docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md` is the source of truth for all content.

**Spec reference:** Throughout this plan, "the spec" means `docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md`. Refer to it before each authoring task.

---

## Workstream A — Repo + GitHub admin (parallel, no rig dependency)

### Task 1: Commit canonical accessions sample to repo

The xlsx upload format is documented in the spec §4 Section 6 and §8 (Subagent B finding). The cleanest existing sample is `/home/graviscan/Desktop/test-metadata-sample.xlsx` on the rig.

**Files:**
- Create: `tests/fixtures/graviscan/README.md` (new dir, README explaining the fixture)
- Create: `tests/fixtures/graviscan/accessions-sample.xlsx` (the canonical sample)

- [ ] **Step 1: Pull the canonical sample from the rig**

```bash
mkdir -p tests/fixtures/graviscan
scp graviscan@graviscan-ms-7c56.tail461d0e.ts.net:/home/graviscan/Desktop/test-metadata-sample.xlsx \
    tests/fixtures/graviscan/accessions-sample.xlsx
ls -la tests/fixtures/graviscan/accessions-sample.xlsx
```

Expected: file exists, ~6.8 KB (matches the size we saw during brainstorming).

- [ ] **Step 2: Verify the xlsx columns match the spec**

```bash
unzip -p tests/fixtures/graviscan/accessions-sample.xlsx xl/sharedStrings.xml | \
  grep -oE '<t[^>]*>[^<]+</t>' | head -10
```

Expected: includes `plate_id`, `plate_section_id`, `plant_qr`, `accession`, `transplant_date`, `medium`, `custom_note` as the first 7 strings (these are the column headers). If the columns don't match the spec, STOP — the fixture is wrong.

- [ ] **Step 3: Write the fixture README**

Path: `tests/fixtures/graviscan/README.md`

```markdown
# GraviScan fixtures

## accessions-sample.xlsx

Canonical sample accessions file for the GraviScan "Upload Accessions"
flow. Used as the linked example in the [Bloom Desktop — GraviScan
operator manual](../../docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md).

**Columns** (header row required; header names below are the
spec-canonical snake_case form, but the in-app column-mapping UI
lets operators map any header to the right field):

| Column | Type | Required | Example |
|---|---|---|---|
| `plate_id` | string | yes | `PLATE_001` |
| `plate_section_id` | string | yes | `S1` |
| `plant_qr` | string | yes | `PLANT-001-A` |
| `accession` | string | yes | `Col-0` |
| `transplant_date` | date | yes | `2025-06-15` |
| `medium` | string | yes | `1/2 MS` |
| `custom_note` | string | no | `replant` |

The sample covers 3 plates × 4 sections = 12 rows, with 3 different
accessions (Col-0, Ler-0, Cvi-0) demonstrating the
"one accession per plate" rule.

**Source:** copied from `/home/graviscan/Desktop/test-metadata-sample.xlsx`
on the production rig 2026-05-26, during the PR #237 rig validation
brainstorm. The same file is uploaded to the team Box folder; the
operator manual links the Box URL.

**Code reference:** see `src/renderer/components/GraviMetadataUpload.tsx`
(validates + parses) and `src/renderer/utils/graviMetadataValidation.ts`
(validation rules).
```

- [ ] **Step 4: Commit the fixture**

```bash
git add tests/fixtures/graviscan/README.md tests/fixtures/graviscan/accessions-sample.xlsx
git commit -m "test(fixture): canonical GraviScan accessions sample (.xlsx, 7 cols, 3 plates)

Source: /home/graviscan/Desktop/test-metadata-sample.xlsx on the
production rig (copied 2026-05-26 during PR #237 brainstorm).

Used as the linked example in the GraviScan operator manual on Notion.
The README in tests/fixtures/graviscan/ documents the column spec +
validation rules + code references.

No code changes; pure test fixture + docs."
```

Expected: 1 commit, 2 files added (xlsx is binary; git tracks it as-is).

---

### Task 2: Comment on issue #203 with Subagent C code-line evidence

Issue #203 ("USB device-number instability edge case: scanner moved to different usb_port") describes the bug Subagent C confirmed during the brainstorm. Add the new code-line evidence as a comment so the issue has the latest analysis attached.

**Files:** none (GitHub API only)

- [ ] **Step 1: Post the comment**

```bash
gh issue comment 203 --repo Salk-Harnessing-Plants-Initiative/bloom-desktop --body "$(cat <<'EOF'
## Confirmed during PR #237 rig validation brainstorm (2026-05-26)

A `superpowers:brainstorming` subagent investigation against the
current `fix/v600-wedge-followups@bb97fc3` source confirms this bug
with code-line precision. Summary:

**Match precedence in `upsertScannerRow`** ([src/main/scanner-upsert.ts:51](src/main/scanner-upsert.ts)):
1. `(usb_bus, usb_device)` — both reshuffle on replug, won't match
2. `usb_port` — changes when the scanner is moved to a different hub port
3. **No `display_name` fallback** — falls through to CREATE

`disableStaleScannerRows` ([src/main/scanner-upsert.ts:198](src/main/scanner-upsert.ts))
then sees the old row's `usb_port` is no longer in the current detection
set and sets \`enabled=false\`. `stopWorkersForDisabledScanners`
([src/main/scanner-upsert.ts:242](src/main/scanner-upsert.ts) — new in
PR #237) kills the old row's worker.

End state when an operator moves a scanner from one USB port to another:
- Old row: still in DB, \`enabled=false\`, holds the historical \`display_name=\"Scanner N\"\`
- New row: brand-new UUID, \`display_name=null\`, \`enabled=true\`
- UI shows an unnamed scanner where \"Scanner N\" used to be
- Future \`GraviScan\` records point at the new UUID
- Cross-experiment continuity for that physical scanner breaks

**Proposed fix:** add a 3rd match attempt in \`upsertScannerRow\` —
match by \`display_name\` if rows 1 and 2 fall through. Risk: a fresh
scanner that happens to share a display_name with a disabled row would
incorrectly re-bind. Mitigation: only match against rows where
\`enabled=true\`.

**Long-term:** see #243's serial-number identity proposal for a
fully stable identifier.

Related: this bug now has an operator-facing warning in the new
GraviScan user manual being authored at
\`docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md\`
(Section 2).
EOF
)"
```

Expected: returns the comment URL.

- [ ] **Step 2: Verify the comment posted**

```bash
gh issue view 203 --repo Salk-Harnessing-Plants-Initiative/bloom-desktop --comments | tail -30
```

Expected: most-recent comment is the one we just posted.

---

### Task 3: File new issue — Wedge response gap

Per spec §8 Subagent D + §4 Section 11: after a wedge alert, the app does NOT pause, retry, or notify the UI. Operator has no `resume` / `skip plate` / `retry` affordance. File a new issue.

**Files:** none (GitHub API only)

- [ ] **Step 1: Search for existing duplicate**

```bash
gh issue list --repo Salk-Harnessing-Plants-Initiative/bloom-desktop \
  --search "wedge resume OR wedge skip OR wedge UI affordance OR scan resume" \
  --state all --limit 10 --json number,title,state
```

Expected: empty `[]` or no exact-match results (we already searched once during brainstorm and confirmed no match; re-check in case something landed since).

- [ ] **Step 2: File the issue**

```bash
gh issue create --repo Salk-Harnessing-Plants-Initiative/bloom-desktop \
  --title "Wedge response gap: no UI affordance to resume / skip / retry after a wedge alert; irreversible data loss for time-lapse experiments" \
  --label "bug,graviscan,enhancement" \
  --body "$(cat <<'EOF'
## Context

During the PR #237 rig validation brainstorm on 2026-05-26, a
\`superpowers:brainstorming\` subagent investigation confirmed that
the WedgeDetector + SlackNotifier chain (added in PR #237 / #236) has
no follow-on behavior beyond posting the Slack alert. This creates
an operator-facing gap that the new GraviScan user manual currently
has to document as 'permanent data loss, no recovery'.

## What the app does NOT do today

Verified against \`fix/v600-wedge-followups@bb97fc3\` source by a
parallel subagent investigation:

1. **No pause** — \`src/main/main.ts:505-539\` \`onWedge\` callback
   only calls \`slackNotifier.notify(enriched)\` + a log line. Does
   NOT invoke \`scanCoordinator.cancel()\`, pause cycle scheduling,
   or signal any subprocess.
2. **No retry** — \`_scan_plate\`
   ([python/graviscan/scan_worker.py:320](python/graviscan/scan_worker.py))
   swallows the wedge error and continues to the next plate. The
   wedged subprocess STAYS ALIVE in a broken state and re-hits the
   wedge every subsequent cycle.
3. **No UI affordance** — only \`graviscan:cancel-scan\`
   ([graviscan-handlers.ts:1691](src/main/graviscan-handlers.ts))
   exists. No \`graviscan:retry-plate\`, \`graviscan:skip-plate\`,
   or \`graviscan:resume\` handlers.
4. **No DB record of the wedge** — Slack POST + log line only.
   Detector state is in-memory; cleared on \`interval-complete\`.

## Why this matters

These are **time-lapse experiments**. Plants grow continuously
during the run. A missed cycle on the wedged scanner cannot be
recovered:

- The plant is in a different state every minute.
- 'Re-running' the missed plate later captures growth from a
  different timepoint, not the missed one.
- For a continuous run, a single un-noticed wedge can wipe out
  hours-to-days of data for the affected scanner's plates.

## Risk analysis (per Subagent D)

- ✅ **Wrong metadata**: safe — \`scan-complete\` never fires for
  failed scans, so no GraviScan row + no file is created for the
  wedged plates.
- ✅ **Duplicate rows**: safe — only one \`scan-complete\` per
  (scanner, plate, cycle).
- 🚨 **Missing data (gaps in experiment wave)**: real — the wedged
  scanner produces zero data until manual power-cycle. NO automatic
  re-scan.
- ✅ **Manual SQL cleanup**: not required — the data is just missing,
  nothing to clean up.

## Today's operator workflow

Currently documented in the new GraviScan operator manual as:

- **Option A** — Continue and accept gaps on the wedged scanner.
- **Option B** — Cancel scan, power-cycle the wedged scanner, restart.

Both lose data. The tradeoff math (\"if you can power-cycle within
~10 min AND >1 hr experiment remaining, Option B usually loses less
than Option A\") leans on operator estimation, not the app helping.

## Proposed UI improvements (any of these would help)

In rough order of value vs. effort:

1. **Per-scanner pause indicator** — when a wedge fires, mark that
   scanner's row in the UI with a 🚨 banner, disable its inclusion
   in subsequent cycles, surface a \`Power-Cycled & Resume\` button.
   On click: spawn a fresh worker for that scanner_id and re-include
   it in the next cycle.
2. **\`wedge_event\` DB table** — persist each wedge as a row so
   post-experiment analysis can see exactly which (scanner, plate,
   cycle) tuples were affected. Makes the gap auditable.
3. **Wedge-skip metadata** — for the wedged plate's missed cycles,
   record a placeholder GraviScan row with a \`failure_reason=wedge\`
   field instead of nothing. Makes the experiment wave self-describing.
4. **Auto-cancel-on-N-wedges policy** — operator-configurable. If a
   scanner wedges N times in a session, automatically remove it from
   subsequent cycles + Slack-notify.
5. **Cancel + auto-restart with same parameters** — operator clicks
   one button; app cancels, waits for the operator to confirm
   power-cycle, then resumes from where it left off (no re-entering
   experiment / phenotyper / wave).

## Related

- #228 (V600 wedge investigation — the upstream root-cause)
- #236 (WedgeDetector + SlackNotifier — what this PR built)
- PR #237 (the rig validation walk that surfaced this gap)
- Operator manual spec: \`docs/superpowers/specs/2026-05-26-graviscan-user-manual-design.md\`
  (Section 11 documents the current workaround)
EOF
)"
```

Expected: returns the new issue URL (e.g., #244, #245 — number depends on what's been filed between brainstorm and execution).

- [ ] **Step 3: Capture the issue number**

```bash
gh issue list --repo Salk-Harnessing-Plants-Initiative/bloom-desktop \
  --author '@me' --limit 3 --json number,title
```

Expected: the new issue at the top. Note the number — needed for the changelog footer in the manual + the operator-facing reference in Section 11.

---

### Task 4: File new issue — Env config UI banner

Per spec §9 and the brainstorm conversation: there's no UI signal that env vars (`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL`, `LIBUSB_ENDPOINT_RECOVERY`) are configured. Operators only know via the startup log lines (journald). File a new issue.

**Files:** none

- [ ] **Step 1: Search for existing duplicate**

```bash
gh issue list --repo Salk-Harnessing-Plants-Initiative/bloom-desktop \
  --search "env config UI OR slack webhook indicator OR LIBUSB UI OR env banner" \
  --state all --limit 10 --json number,title,state
```

Expected: empty or no exact match (verified during brainstorm; re-check).

- [ ] **Step 2: File the issue**

```bash
gh issue create --repo Salk-Harnessing-Plants-Initiative/bloom-desktop \
  --title "Add UI banner showing Slack webhook + LIBUSB_ENDPOINT_RECOVERY env-var state" \
  --label "enhancement,graviscan,UI" \
  --body "$(cat <<'EOF'
## Context

During the PR #237 rig validation brainstorm on 2026-05-26, the
operator asked: \"How do I know if the env was set up correctly?\"
A code search confirmed there is no UI indicator — operators have
to inspect journald (or grep the startup log) for these lines:

\`\`\`
[GraviScan] Slack webhook URL loaded from ~/.bloom/.env
   OR
[GraviScan] BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL not set — Slack notifications disabled

[GraviScan] LIBUSB_ENDPOINT_RECOVERY explicitly set to: true
   OR
[GraviScan] LIBUSB_ENDPOINT_RECOVERY not set in env — wrapper defaults to ON
\`\`\`

## Why this matters

If the Slack webhook is misconfigured (URL missing, wrong, or
rate-limited at the Slack end), the operator gets NO wedge alerts —
which means a wedged scanner can produce missing-data gaps for
hours or days before anyone notices. The whole point of the
WedgeDetector + SlackNotifier infrastructure (#236) is real-time
notification; silent misconfiguration defeats that.

LIBUSB_ENDPOINT_RECOVERY is less critical (defaults to ON in the
C-shim when the env var is absent, per
\`src/main/native/libusb-filter.c:140\`), but the operator should
still be able to verify it explicitly.

## Proposed UI

Add a small status pill in the app header (top-right corner) that
shows the env-var state at-a-glance:

\`\`\`
 [✓ Slack: on]   [✓ libusb-recovery: on]
\`\`\`

Colors:
- Green ✓ — both configured + Slack reachable (last test < 1 hour ago)
- Amber ⚠ — configured but stale-test (> 1 hour) or one missing
- Red ✗ — Slack URL absent or last test failed

Click the pill → modal with details + 'Test Slack' button that
POSTs a no-op message to the webhook + reports the HTTP status.

## Why a pill, not a banner

A banner is wasted screen space when both are green (the common
case). A pill is unobtrusive when green, attention-grabbing when
red/amber. Pattern matches the existing Mock Mode banner (which
only appears when active).

## Code locations

- Env-var load: \`src/main/main.ts:1251-1295\`
- Env-var hydration: \`src/main/main.ts:1260-1280\`
- IPC handler to add: \`graviscan:get-env-status\` (new)
- React component to add: \`src/renderer/components/EnvStatusPill.tsx\`

## Related

- PR #237 (which added the env vars but didn't add UI for their state)
- #236 (WedgeDetector + SlackNotifier — depends on this env to work)
- Operator manual spec section 0 pre-flight checklist item #5
  references this gap; once shipped, pre-flight wording simplifies.
EOF
)"
```

Expected: new issue URL.

- [ ] **Step 3: Capture the issue number** (same command as Task 3 Step 3) for the changelog footer.

---

## Workstream B — Operator-side pre-requisites (USER TASKS)

These tasks require physical access to the rig OR access to Box / Slack — they cannot be done by Claude. Mark them as completed only after the user reports completion. Each one is a hand-off point.

### Task 5: [USER TASK] Set up 14.6 TB partition redirect

Per spec §8 Subagent A: the rig has a 14.6 TB `/dev/sda1` mounted at `/data` that's currently unused. Redirect scan output there before the manual ships.

- [ ] **Step 1: USER — `chown` `/data/bloom` to graviscan**

On the rig terminal (with sudo password):

```bash
sudo mkdir -p /data/bloom
sudo chown graviscan:graviscan /data/bloom
ls -la /data/bloom
```

Expected: directory exists, owned `graviscan:graviscan`.

- [ ] **Step 2: USER — Set Scans Dir via Machine Configuration UI**

In the running bloom-graviscan app: navigate to Machine Configuration page → find the **Scans Dir** field → enter `/data/bloom/graviscan` → click Save. The app should auto-create the subdirectory and write the new value to `~/.bloom/.env` as `SCANS_DIR=/data/bloom/graviscan`.

- [ ] **Step 3: USER — Verify the redirect via SSH**

```bash
grep '^SCANS_DIR=' ~/.bloom/.env
ls -la /data/bloom/graviscan
df -h /data
```

Expected: `SCANS_DIR=/data/bloom/graviscan` in env file; directory exists and is empty; `/data` shows 14 TB free.

- [ ] **Step 4: USER — Run a 1-cycle test scan to confirm files land on /data**

In the app: GraviScan page → 1-cycle continuous scan on 1 scanner with 4 plates → start. After it completes, verify:

```bash
ls -la /data/bloom/graviscan/<experiment>_<timestamp>/
```

Expected: 4 `.tif` files on `/data`, not under `~/.bloom`.

- [ ] **Step 5: USER — Confirm completion**

Tell the Claude session: "Task 5 done — /data redirect is live". I (Claude) will then unblock the manual's Section 0 + 10 phrasing (drop the conditional "if Machine Config has been pointed at /data" language).

### Task 6: [USER TASK] Upload accessions sample to Box

After Task 1 commits the fixture to the repo, the same file needs to land in a Box folder operators can access. The manual's Section 6 will link the Box URL.

- [ ] **Step 1: USER — Decide which Box folder**

Pick the operator-accessible Box folder where GraviScan team documents live. Typical candidates: the existing GraviScan backup folder, the team's shared "Bloom Desktop" folder, etc. Coordinate with Benfica if unsure.

- [ ] **Step 2: USER — Upload the file**

Upload `tests/fixtures/graviscan/accessions-sample.xlsx` (from the repo, after Task 1) to the chosen Box folder. Rename to `GraviScan_Accessions_Sample.xlsx` for operator-friendliness.

- [ ] **Step 3: USER — Capture the shareable URL**

In Box: right-click the file → Share → Copy Link → choose "Anyone in the company" or whatever the appropriate read-only audience is.

- [ ] **Step 4: USER — Send the URL back**

Paste the URL into the Claude session: "Sample file URL: `<box-url>`". I (Claude) will then use it in the manual's Section 6 and Section 10.

### Task 7: [USER TASK] Capture 10 screenshots at the rig

Per spec §6: 10 must-have screenshots. Capture them in one focused ~20-30 min session at the rig.

- [ ] **Step 1: USER — Stage the rig**

- Ensure the app is running normally
- Ensure all 5 scanners are green
- Ensure mock mode is OFF
- Ensure scanner #4 (the one whose worker we'll temporarily unplug for screenshot #4) is identified — see Task 5 in the rig validation doc for which physical scanner that is.

- [ ] **Step 2: USER — Capture each screenshot**

For each numbered screenshot below, use `gnome-screenshot` (or Print Screen) on the rig + save to `~/Pictures/graviscan-manual/`. Suggested filenames:

```
01-app-icon-desktop.png
02-app-main-no-mock-banner.png
03-configure-scanner-all-green.png
04-configure-scanner-one-red.png  ← see Step 3
05-new-experiment-form.png
06-upload-accessions-modal.png
07-plate-placement-physical.jpg   ← phone photo, not screenshot
08-cadence-warning-banner.png
09-browse-scans-files-listed.png
10-slack-wedge-alert.png          ← screenshot of the synthetic test message already in #topic-graviscan-alerts
```

Details for what each shows are in spec §6.

- [ ] **Step 3: USER — Capture screenshot #4 (one-red state)**

Either (a) skip it and use text-only description in the manual; (b) reproduce a red state intentionally by briefly unplugging Scanner 4's USB cable, capturing the screenshot, then replugging + clicking Reset USB to restore the green state. If choosing (b): expect ~5 min of recovery time, then verify all 5 green before doing other captures.

- [ ] **Step 4: USER — Confirm captures done**

Tell the Claude session: "Task 7 done — N screenshots captured at `~/Pictures/graviscan-manual/`". I will then transfer them down for review, OR you can attach them directly to the Notion page in Task 11.

---

## Workstream C — Author the Notion page

### Task 8: Draft the full Notion page body as enhanced Markdown

The spec §4 has the full section walkthrough. This task is to convert it into Notion's enhanced-markdown format (the format the MCP `notion-create-pages` tool accepts) and save as a draft file in the repo. This way the content can be reviewed in-place before any Notion API call.

**Files:**
- Create: `docs/superpowers/drafts/graviscan-user-manual-notion-body.md` (the source of truth for the Notion page body)

- [ ] **Step 1: Read the Notion enhanced-markdown spec**

```bash
# Available via MCP resource:
# notion://docs/enhanced-markdown-spec
```

Need to know: how callouts (`<callout icon="📢" color="...">`), `<mention-page>` links, image embeds, tables, and code blocks are encoded.

- [ ] **Step 2: Draft the Markdown file**

Write the entire body content following spec §4 exactly. Section structure: 0 pre-flight + 1-11 walkthrough. Include:

- Header callout at top: "Last updated: 2026-05-26 — verified against bloom-graviscan v0.1.0 on branch fix/v600-wedge-followups@bb97fc3..."
- 13 inline guardrails with exact wording from spec §3 / §5 (use the exact callout text from spec §3 chat list / spec §5)
- All 10 screenshot placeholders embedded as `<!-- SCREENSHOT N: ... -->` HTML comments that map to the spec §6 inventory
- `<mention-page>` placeholders for cross-links (Phenotypers, Scientists, Experiments, Brady QR, V600 Investigation Summary — IDs TBD until lookup in Task 9)
- Footer changelog (5 most-recent entries; 4 are TBD-forward-looking)
- Maintainer block at the bottom

Reference the spec for every section's body content — DO NOT paraphrase or invent. Copy/paste from spec §4 and adapt only for formatting (e.g., turn the tables into Notion table syntax, turn the bullet lists into Notion bullet lists).

- [ ] **Step 3: Self-check the draft against spec §5 guardrails registry**

Grep the draft for each emoji marker:

```bash
grep -c '🚨' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 2
grep -c '⚠️' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 3
grep -c '📢' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 6
grep -c '🔬' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 1
grep -c '💡' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 1 + header callout (2 total)
```

Expected counts above. If off, the draft is missing or has extra callouts. Fix before continuing.

- [ ] **Step 4: Self-check screenshot placeholders**

```bash
grep -c 'SCREENSHOT' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 10
```

- [ ] **Step 5: Commit the draft**

```bash
git add docs/superpowers/drafts/graviscan-user-manual-notion-body.md
git commit -m "draft: GraviScan user manual body in Notion enhanced markdown

Source-of-truth Markdown file for the new Notion page (Engineering
Wiki → Protocols → 🪴 Bloom Desktop — GraviScan). Will be ingested
into Notion in the next task via the notion-create-pages MCP tool.

Implements spec §4 section structure (0 + 1-11), §5 guardrails
registry (5 pre-flight + 13 inline callouts), §6 screenshot
placeholders (10), §7 maintenance header + footer.

Mention-page IDs for cross-links are TBD placeholders; resolved in
the next task before publishing to Notion."
```

---

### Task 9: Resolve cross-link mention-page IDs

Cross-links in the manual use `<mention-page url="https://www.notion.so/<id>"/>` syntax. The spec §2 lists which pages to link to. This task is to look up each page's URL via the Notion API.

**Files:**
- Modify: `docs/superpowers/drafts/graviscan-user-manual-notion-body.md` (replace TBD placeholders with real URLs)

- [ ] **Step 1: Find Phenotypers admin page**

```
mcp__claude_ai_Notion__notion-search query="Phenotypers" query_type=internal
```

Look for the admin page operators use to add phenotypers. May be a sub-page of the cylinder doc or a standalone page. Note the URL.

- [ ] **Step 2: Find Scientists admin page** — same approach with `query="Scientists"`.

- [ ] **Step 3: Find Experiments admin page** — same approach with `query="Experiments"`.

- [ ] **Step 4: Find "Making QR Codes with Brady Label Maker"**

Already known from the brainstorm; URL is `https://www.notion.so/1304a67a766780bd812de2490cb412ef`.

- [ ] **Step 5: Find "V600 USB Wedge Investigation Summary"**

Already known from the brainstorm; URL is `https://www.notion.so/3664a67a76678161b6bdfb985092f4d8`.

- [ ] **Step 6: Edit the draft to insert real URLs**

For each `<!-- MENTION_PAGE: ... -->` placeholder in `docs/superpowers/drafts/graviscan-user-manual-notion-body.md`, replace with `<mention-page url="https://www.notion.so/<id>"/>`. Verify with:

```bash
grep -c 'MENTION_PAGE' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 0
grep -c '<mention-page' docs/superpowers/drafts/graviscan-user-manual-notion-body.md  # expect 5 (one per cross-link)
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/drafts/graviscan-user-manual-notion-body.md
git commit -m "draft: resolve cross-link mention-page IDs in GraviScan manual body

Replaces the 5 TBD MENTION_PAGE placeholders with real Notion URLs
for Phenotypers, Scientists, Experiments admin pages + the Brady
QR + V600 Wedge Investigation Summary pages."
```

---

### Task 10: Create the Notion page via MCP API

With the draft finalized in Task 9, create the actual Notion page under the Protocols parent.

**Files:** none (Notion API only)

- [ ] **Step 1: Load the `notion-create-pages` tool schema**

```
ToolSearch query="select:mcp__claude_ai_Notion__notion-create-pages"
```

- [ ] **Step 2: Read the drafted body**

```bash
cat docs/superpowers/drafts/graviscan-user-manual-notion-body.md
```

Copy the entire content for the API call.

- [ ] **Step 3: Create the page**

Call `mcp__claude_ai_Notion__notion-create-pages` with:

```json
{
  "parent": {
    "type": "page_id",
    "page_id": "1144a67a-7667-81ae-9f1f-d32fdb47437d"
  },
  "title": "🪴 Bloom Desktop — GraviScan",
  "content": "<contents of draft file from Step 2>"
}
```

Expected: returns the new page URL + page ID. Capture both.

- [ ] **Step 4: Verify the page rendered**

```
mcp__claude_ai_Notion__notion-fetch id="<new page URL from Step 3>"
```

Inspect the rendered page. Check:
- Title shows with the 🪴 emoji
- Header callout is at the top
- 12 sections present (0 + 1-11)
- All 13 inline emoji callouts are visible
- 10 screenshot placeholders are present (as text — operator will replace with images in Task 11)
- 5 `<mention-page>` links resolve to actual links (not raw URLs)
- Footer changelog + maintainer block present

If anything is missing or malformed, use `mcp__claude_ai_Notion__notion-update-page` to fix sections individually rather than recreating the whole page.

- [ ] **Step 5: Capture the page URL**

Save the new page URL in your scratchpad — needed for Task 12 + for the user to bookmark.

---

### Task 11: [USER TASK] Operator adds screenshots + Box URL

Now that the page exists, the user fills in the 10 image embeds and the Box URL.

- [ ] **Step 1: USER — Open the new Notion page**

URL from Task 10 Step 5.

- [ ] **Step 2: USER — For each `<!-- SCREENSHOT N: ... -->` placeholder, drag-drop or paste the corresponding screenshot file**

The placeholder line in the page body becomes a Notion image block when an image is dropped onto it.

- [ ] **Step 3: USER — Replace the Box URL placeholder in Section 6**

Search the page for the `<!-- BOX_URL: ... -->` placeholder and paste the Box URL from Task 6 Step 3 in its place. Save.

- [ ] **Step 4: USER — Confirm screenshots + URL all in place**

Tell the Claude session: "Task 11 done — all 10 images embedded + Box URL inserted".

---

### Task 12: Verify final page + update header callout date

Final pass to make sure the page is publish-ready, then refresh the "Last updated" date.

**Files:** none (Notion API only)

- [ ] **Step 1: Fetch the page to verify it's complete**

```
mcp__claude_ai_Notion__notion-fetch id="<new page URL>"
```

Check that:
- No `<!-- ... -->` placeholders remain (would have leaked from Task 8/9)
- All 10 image embeds resolved (not empty placeholders)
- Box URL resolves to a clickable link
- All 5 `<mention-page>` links work
- The header callout's "Last updated" matches today's date

- [ ] **Step 2: If the header callout date is stale, update it**

Use `mcp__claude_ai_Notion__notion-update-page` with the block containing the header callout. Replace `2026-05-26` with today's date (the date the operator finished embedding images and Box URL).

- [ ] **Step 3: Post a Slack announcement in `#topic-graviscan-alerts`**

Brief post (the user does this — Claude can draft):

> 🪴 New operator user manual for GraviScan: <URL>. Walks through pre-flight, daily scan workflow, and what to do on a wedge alert. Maintained by Benfica + Elizabeth; ping here to suggest changes.

- [ ] **Step 4: Mark completion**

Tell the Claude session: "Task 12 done — manual published". I'll update the brainstorm-session todo list to mark all GraviScan-manual tasks complete.

---

## Self-Review

Looking at this plan with fresh eyes against the spec:

**1. Spec coverage check:**

- ✅ Spec §1 Goal — manual is the primary deliverable (Tasks 8-12)
- ✅ Spec §2 Placement — Task 10 uses the Protocols page ID
- ✅ Spec §3 Approach — Task 8 follows the linear-walkthrough single-page structure
- ✅ Spec §4 Section structure — Task 8 Step 2 maps 1-to-1 to spec §4
- ✅ Spec §5 Guardrails — Task 8 Step 3 verifies counts
- ✅ Spec §6 Screenshots — Task 7 captures, Task 11 embeds
- ✅ Spec §7 Maintenance — Task 8 includes header callout + footer
- ✅ Spec §8 Subagent findings — preserved in the spec; Tasks 2-4 act on them
- ✅ Spec §9 Follow-up actions:
  - #1 10TB partition → Task 5
  - #2 Accessions fixture → Task 1
  - #3 Comment on #203 → Task 2
  - #4 New wedge issue → Task 3
  - #5 New env-banner issue → Task 4
  - #6 Screenshots → Task 7
  - #7 Box URL → Task 6
- ✅ Spec §10 Out-of-scope — plan doesn't try to do any of it

**2. Placeholder scan:**

- The plan contains intentional `<URL>` / `<box-url>` / `<new page URL>` references — these are runtime values produced by earlier steps; not "TBD" placeholders. OK.
- No "implement appropriate error handling", "write tests for the above", or "similar to Task N" patterns.

**3. Type consistency:** N/A — this plan doesn't define types or function signatures.

**4. Ordering:**

- Workstream A (admin) is independent — can run in any order
- Workstream B has internal ordering: Task 5 (partition) doesn't block 6 (Box) or 7 (screenshots); 6 must complete before Task 11 Step 3
- Workstream C: 8 → 9 → 10 → 11 → 12 strict sequence
- Cross-workstream: Task 1 must complete before Task 6 (the file to upload to Box doesn't exist until Task 1 commits the fixture). All other cross-workstream pairs are independent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-graviscan-user-manual.md`.

**Notes for the executor (whoever runs this plan):**

- Tasks 5, 6, 7, 11 are USER TASKS — they require physical rig access OR Box / Slack permissions and cannot be done by Claude alone
- Workstream A (Tasks 1-4) can be run by Claude immediately, in parallel — no rig dependency
- Workstream B (Tasks 5-7) is the user's homework; Claude can prepare instructions but the user does the work
- Workstream C (Tasks 8-12) needs Task 1 + Task 6's URL + Task 7's screenshots before publication is complete

Two execution options when the user is ready:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task in Workstream A (Tasks 1-4 in parallel), review between them, then proceed to Workstream C drafting (Task 8) while the user works on Workstream B (Tasks 5-7).

**2. Inline Execution** — I execute Workstream A + C in this session sequentially using `superpowers:executing-plans`, with checkpoints between each task for the user to review.
