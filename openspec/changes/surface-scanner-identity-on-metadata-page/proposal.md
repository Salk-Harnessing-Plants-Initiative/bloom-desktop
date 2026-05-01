# surface-scanner-identity-on-metadata-page

## Why

The Metadata page is where lab operators type plant barcodes, transplant dates, and custom notes per plate. **Today its only cue tying a plate to a physical scanner is `<h3>Scanner: {raw UUID}</h3>`** ([Metadata.tsx:258-260](../../../src/renderer/graviscan/Metadata.tsx#L258-L260)) — gibberish to humans. With two identical Epson V850s in the lab, operators literally cannot tell which row corresponds to which physical scanner. The pilot implementation by Benfica had a richer UX — `"{slot}: {scanner.name} [grid-mode]"` headers, a per-scanner thumbnail card with live test-scan images, color-coded status, click-to-zoom — all of which got flattened in the port to the current routes-based layout. Three full subagent investigations confirm: this is the deepest scientific-integrity risk in the GraviScan stack, because typed metadata is welded to whichever `scanner_id` happened to be in renderer state at typing time, with **zero validation** that the binding matches physical reality.

This proposal restores the pilot's per-scanner thumbnail UX (`ScanPreview.tsx`, `ImageLightbox.tsx`, `ScannerPanel.tsx` — already in git history at `47330db`), surfaces the identity fields the system already has (`display_name`, `usb_port`, `firmware_serial` from Proposal 2), and adds GxP-grade checkpoints that prevent silent mis-attribution. **Scientific integrity becomes operator-verifiable, not operator-trust-based.**

This proposal stacks on `add-scanner-firmware-serial-identity`. It degrades gracefully if Proposal 2 hasn't shipped (no firmware_serial → soft-gate uses USB-topology suggestions instead of serial-aware naming).

## Related Issues

- `Related: #182, #203` — the scientific-integrity story closes here at the UX layer.
- `Related: #217` — mid-session replug detection (deferred follow-up).
- Restores UX dropped in commits `42d2eda` and the post-`47330db` refactor sequence.

## Data Integrity Impact

**Pre-fix behavior:** 13 distinct silent-mis-attribution paths confirmed by audit (see the design notes). The operator has no way to verify a typed barcode landed on the right physical scanner, no UI affordance to edit `display_name`, no test-scan thumbnail to disambiguate identical-model scanners, and no confirmation summary at Start Scan. metadata.json reaches disk with the wrong `scanner_name` and the operator never knows.

**Post-fix behavior:**

- Each scanner panel on Metadata.tsx, GraviScan.tsx, and the Start Scan modal shows: `display_name` · `usb_port` · live test-scan thumbnail of what is physically on the glass · color-coded left border by `usb_port` hash. **The operator sees their own labeled plates and confirms "yes, that's the row I'm typing data for."**
- An "Identify this scanner" button per row fires a single-plate test scan; the operator watches which physical scanner whirrs to life. Lab-equipment "blink LED to find me" pattern.
- `display_name` is editable on Scanner Config via inline pencil-icon. Soft-gate banner appears at save time when ≥2 scanners share `(name, vendor_id, product_id)` — operator can pick from auto-suggested USB-topology names ("USB 1-1 (back-left)"), apply previously-saved names, or skip. **Never starts from a blank field.**
- Plate-metadata editing is BLOCKED until scanners are saved — banner: "Save scanner configuration before entering plate metadata." Stops the type-then-save data-loss path that wiped barcodes through the `scannerAssignmentsKey` flip.
- Typed barcodes are now MAPPED FORWARD when scanner_id flips from `''` → real UUID at save (no more silent renderer-state wipe).
- For `isGraviMetadata` experiments, the barcode field becomes a dropdown sourced from accession metadata + genotype sidecar (pilot UX restoration). Free-text fallback for non-metadata experiments.
- Start Scan summary modal (auto-on for ≥2 scanners): read-only ScanPreview cards + checkbox "I have verified the physical scanners and plate positions match this list" — GxP-grade checkpoint before any data is committed to metadata.json.
- `transplant_date` and `custom_note` editing is wired (currently a silent metadata gap — fields exist in DB and JSON but the renderer handlers are unwired in `Metadata.tsx:266-268`).
- Per-cycle metadata refresh in continuous mode via new IPC `gravi:updateSessionMetadata` so an operator can correct a typo or update a transplant date mid-session without restarting.

## What Changes

### A. Restore three pilot components (~600 LOC, mostly git checkout from `47330db`)

- **`src/renderer/components/ScanPreview.tsx`** (357 lines, ~10 LOC adaptation): per-scanner thumbnail card with grid layout matching scan config. Each plate cell shows: empty placeholder, scanning spinner, OR the actual scanned image (from `scanImageUris[scannerId][plateIndex]`). Click-to-zoom via lightbox. Status pill color-coded by state.
- **`src/renderer/components/ImageLightbox.tsx`** (98 lines, drop-in): Esc to close, arrow keys for prev/next, max-90vh image, optional caption. Pure React.
- **`src/renderer/components/ScannerPanel.tsx`** (145 lines, **~10-15 LOC adaptation** for the `enabled`-field-removal): online/busy LED indicators, color-coded status background, progress bar, output filename. Replaces the current single grey-blue state pill on GraviScan.tsx. Adaptation requires adding a new `scannerAssignments` prop (threading through call sites) and deriving `enabled` from `scannerAssignments.some(a => a.scannerId === scanner.scannerId)`. Earlier estimates of "~5 LOC" understated the prop-threading cost.

The components compile against types that still exist (`ScannerAssignment`, `PlateAssignment`, `GridMode`, `ScannerPanelState`, `formatPlateIndex`).

### B. Replace UUID-only labels with rich identity headers

- **`src/renderer/graviscan/Metadata.tsx:258-260`**: replace `<h3>Scanner: {scannerId}</h3>` with `<h3>{display_name ?? slot} · {scanner.name} · USB {usb_port}</h3>` plus a `text-gray-500` sub-line `vendor_id:product_id` and (when available from Proposal 2) `serial: <short>`. Three identifying fields visible at all times.
- **`src/renderer/graviscan/BrowseGraviScans.tsx`**: show `display_name`, `usb_port`, and `firmware_serial` per historical scan so retroactive audits work.

### C. "Identify this scanner" button per row

Single-plate Test Scan that pulses the resulting thumbnail in `ScanPreview` for ~3s. Reuses existing `useTestScan.ts`. ~25 LOC. Lab-equipment "blink LED to find me" pattern; resolves identical-model ambiguity instantly.

### D. Color-code each scanner panel by usb_port hash (colorblind-safe)

A small utility `usbPortToHueAndStyle(usb_port: string): { color: string; borderStyle: 'solid' | 'dashed' | 'dotted' | 'double' }` returning a stable (hue, border-style) pair from a hash of the port string. Used on every scanner panel/card across Metadata.tsx, ScannerConfig.tsx, GraviScan.tsx, ScanPreview, and the GxP modal. Same scanner, same pair, same place every time. **The palette is Wong's 8-color colorblind-safe palette** (black, orange, sky-blue, bluish-green, yellow, blue, vermillion, reddish-purple), paired with a 4-style cycle (solid/dashed/dotted/double) so red-green and blue-yellow colorblind users still see uniquely-distinguishable scanners via pattern. Falls back to a hash of the composite key on empty-port platforms. ~30 LOC including the palette constants + utility + a unit test asserting pair-uniqueness for the 8 most-likely usb_port values.

### E. Block plate-metadata editing on placeholder ids

Render a banner at the top of `Metadata.tsx` when `scannerAssignments.some(a => a.scannerId === '' || a.scannerId === null)`: "Save scanner configuration before entering plate metadata. Unsaved scanner changes will be lost." Disable all `PlateGridEditor` inputs while this banner is visible. ~15 LOC.

### F. Wire missing transplant_date and custom_note handlers

`Metadata.tsx:266-268` currently passes only `onBarcodeChange` to `PlateGridEditor`. The other two handlers (`onTransplantDateChange`, `onNoteChange`) exist on `PlateGridEditor` and the underlying state shape but are unwired. **Wire them.** ~10 LOC. (This is a silent metadata gap fix that should arguably be in Proposal 1 — but it's UX-adjacent so it lands here.)

### G. Map renderer state forward through `scannerAssignmentsKey` flips

`usePlateAssignments.ts:93-143` currently wipes `scannerPlateAssignments` to defaults when `scannerAssignmentsKey` changes (e.g., when `scanner_id` flips from `''` → real UUID at save). Replace the wipe with a forward-mapping pass that **preserves `plantBarcode`, `transplantDate`, `customNote`** from the old `''`-keyed slot into the new UUID-keyed slot before clearing. Saves operator typing data through the save→re-detect cycle. ~30 LOC.

### H. Soft-gate `display_name` on save (no hard gate)

When the user clicks Save on ScannerConfig and ≥2 scanners share `(name, vendor_id, product_id)`, show a banner above the Save button:

> **Two identical Epson V850 scanners detected.** Naming each one (e.g., "Bench-3-Left") makes plate metadata easier to verify.
> [Skip] [Suggest names] [Use bench labels…]

- **Suggest names** auto-generates from USB topology: `"USB 1-1 (back-left)"`, `"USB 1-2 (front-right)"`. Operator confirms or edits.
- **Use bench labels…** opens a small dialog where the operator can paste/type bench labels per row.
- **Skip** proceeds with the existing default (`display_name: undefined` → main-process upsert preserves whatever's already there, or sets to `name`).
- On subsequent saves, **pre-fill the field with the prior `display_name`** so the operator never starts from blank.

~60 LOC + a small "suggest names" generator + a small dialog component.

### I. Editable `display_name` column on Scanner Config

Inline pencil-icon input next to each scanner row in `ScannerConfig.tsx`. Pre-filled with the saved `display_name` (or auto-suggested name on first save). Editing posts the change via the existing `saveScannersToDB` IPC with the typed `display_name` (instead of always-`undefined`). ~30 LOC.

### J. GxP-style Start Scan confirmation modal

Auto-on for ≥2 enabled scanners; auto-skipped for 1 scanner. Triggered before any IPC `gravi.startScan` call. Renders:

- Each enabled scanner as a read-only ScanPreview card showing display_name, usb_port, firmware_serial (when available), and the live test-scan thumbnail
- For each scanner, a list of selected plates with plate_index, barcode, transplant_date, custom_note, and (when present) the genotype/accession sidecar
- A required checkbox: "I have verified the physical scanners and plate positions match this list"
- [Cancel] [Start scan] buttons. Start Scan disabled until checkbox is ticked.

~80 LOC. The modal is a defense-in-depth checkpoint, not a replacement for the upstream identity work — those still must hold for the modal's content to be correct.

### K. Restore plate-barcode dropdown for `isGraviMetadata` experiments

`PlateGridEditor.tsx` currently uses a free-text `<input>`. Restore the pilot's `<select>` sourced from `availableBarcodes` (already computed by `usePlateAssignments`), with the genotype/accession shown inline as a sidecar. Free-text fallback when the experiment is not `isGraviMetadata`. ~50 LOC.

### L. Show usb_port + display_name + firmware_serial on BrowseGraviScans

Currently shows only `scanner.name`. Add `display_name`, `usb_port`, and `firmware_serial` (when populated) per scan row. Lets the operator audit retroactively: "wave 3's scans say Bench-3 at port 1-1 with serial ABC123 — does that match my logbook?" ~30 LOC.

### M. Empty-state message untangle

`Metadata.tsx:273-278` currently conflates "no experiment selected" with "no saved scanners". Split into two distinct messages with a "Go to Scanner Config" button when scanners aren't saved. ~10 LOC.

### N. Reset confirmation modal

`useScannerConfig.ts:429-459`'s reset wipes config without confirmation. Add a small modal: "This will reset scanner config but keep plate metadata. Continue? [Cancel] [Reset]". ~20 LOC.

### O. Per-cycle metadata refresh IPC

New IPC handler `gravi.updateSessionMetadata({ experiment_id, scanner_id, plate_index, plant_barcode?, transplant_date?, custom_note? })`. Mutates `coordinator.sessionContext` between cycles. Renderer surfaces a "Pause and edit metadata" button on GraviScan.tsx during continuous mode. Audit-logged via `GraviScannerBinding` (Proposal 2's table) with `reason: 'manual:user-confirmed'` and a free-form note field for the change. ~80 LOC.

### P. "What does USB 1-1 mean?" tooltip

A small `?` info icon next to `USB <port>` on Scanner Config that reveals: "USB ports are numbered by your operating system based on physical hub topology. `1-1` is the first port on your first hub. We recommend labeling your physical USB hub ports with the included stickers so this is unambiguous." ~15 LOC.

## Impact

**Affected specs:**

- `scanning` — **MODIFIED** `GraviScan Metadata Page` (carries forward all 5 prior scenarios verbatim plus 11 new scenarios for the identity-display invariants, test-scan thumbnails, color codes, blocked editing on placeholder ids, forward-mapping with inverse-leak safety, transplant_date and custom_note wiring, barcode dropdown, per-cycle metadata refresh, and empty-state untangle).
- `scanning` — **ADDED** `GraviScan Scanner Configuration Page UX Affordances` requirement scoped to display_name editor, soft-gate banner with reappearance behavior, "Identify this scanner" button with concurrency guard, reset confirmation modal, USB-topology tooltip, and color-coded panels. Carries the existing `GraviScan Scanner Configuration Page` invariants forward unchanged via reference; uses ADDED to avoid the verbatim-carry-forward burden on the large pre-existing requirement.
- `scanning` — **ADDED** `GraviScan Scanning Page Scanner-Identity Surfaces` requirement scoped to ScannerPanel (LED states), ScanPreview integration, GxP-style Start Scan confirmation modal with persisted snapshot evidence, and "Pause and edit metadata" mid-session affordance. Uses ADDED for the same reason as above.
- `scanning` — **ADDED** `GraviScan Browse Page Identity Columns` requirement scoped to retrospective audit visibility on BrowseGraviScans.

**Affected code:**

- `prisma/schema.prisma` — **add `start_confirmation_snapshot Json?` column to `GraviScanSession`** so the GxP modal's confirmation evidence is auditable post-hoc, not theater. Migration: `add_session_confirmation_snapshot`.
- `src/renderer/components/ScanPreview.tsx` (restored from `47330db`, ~370 LOC).
- `src/renderer/components/ImageLightbox.tsx` (restored, ~98 LOC).
- `src/renderer/components/ScannerPanel.tsx` (restored, ~150 LOC, ~10-15 LOC adaptation for `enabled`-derivation).
- `src/renderer/components/StartScanConfirmModal.tsx` (new, ~80 LOC) — GxP-grade scan-confirmation modal that builds the persisted snapshot.
- `src/renderer/graviscan/Metadata.tsx` — rich H3 header, banner, wired-up handlers, ScanPreview integration, color codes, empty-state untangle.
- `src/renderer/graviscan/ScannerConfig.tsx` — display_name editor, soft-gate banner with session/per-experiment opt-out, suggest-names dialog, "Identify" button with concurrency guard, color codes, USB-topology tooltip, reset confirmation modal.
- `src/renderer/graviscan/GraviScan.tsx` — ScannerPanel integration, ScanPreview integration, GxP modal trigger before Start Scan, color codes, "Pause and edit metadata" affordance during continuous-mode interval waits.
- `src/renderer/graviscan/BrowseGraviScans.tsx` — extra columns for `display_name`, `usb_port`, `firmware_serial`.
- `src/components/graviscan/PlateGridEditor.tsx` — barcode `<select>` for `isGraviMetadata`, genotype sidecar, color-coded card border. **NOTE**: the change from `<input>` to `<select>` is BREAKING for any existing tests that target the input by tag/role; tasks 1.7 and 3.x explicitly verify and update affected selectors.
- `src/renderer/hooks/usePlateAssignments.ts` — preserve typed barcodes through `scannerAssignmentsKey` flips with explicit inverse-leak guard (placeholder→UUID only) AND coordination with the experiment-load DB-reset effect.
- `src/renderer/hooks/useScannerConfig.ts` — surface display_name editing, surface auto-rebind toast / replacement modal (from Proposal 2's IPC contract), surface suggested names.
- `src/renderer/hooks/useTestScan.ts` — single-scanner test-scan path for the "Identify" button + `pulsingScannerId` state for the concurrency guard.
- `src/main/graviscan/session-handlers.ts` — new `gravi.updateSessionMetadata` IPC handler with locking semantics; persistence of `confirmation_snapshot` into the new schema column.
- `src/main/graviscan/scan-coordinator.ts` — accept mid-session metadata updates via `coordinator.updatePlateMetadata(scannerId, plateIndex, updates)` (new method with explicit lock to prevent racing with `scanOnce`'s read of the maps).
- `src/utils/usb-port-color.ts` (new) — `usbPortToHueAndStyle` utility with Wong's 8-color colorblind-safe palette + 4-style border pairing.
- `src/types/graviscan.ts` — extend `ScannerAssignment` with `display_name: string | null` so the inline editor has a typed slot. (Reviewer flagged this as buried; surfacing here.)

**Affected tests:**

- `tests/unit/components/ScanPreview.test.tsx` (new) — render thumbnail grid, click-to-zoom dispatches lightbox.
- `tests/unit/components/ImageLightbox.test.tsx` (new) — keyboard nav.
- `tests/unit/components/ScannerPanel.test.tsx` (new) — LED states; enabled-derivation from scannerAssignments.
- `tests/unit/utils/usb-port-color.test.ts` (new) — stable hue per port; consistency across calls.
- `tests/unit/graviscan/Metadata.test.tsx` (new or extended) — rich H3 renders all three fields; banner blocks editing on placeholder ids; transplant_date and custom_note actually save.
- `tests/unit/graviscan/ScannerConfig.test.tsx` (new or extended) — display_name editor flow; soft-gate banner appears for identical-model scanners; suggested-names generator.
- `tests/unit/hooks/usePlateAssignments.test.ts` — extend with "barcodes preserved through scanner_id `''`→UUID flip" regression.
- `tests/integration/update-session-metadata.test.ts` (new) — mid-session metadata edit propagates to next cycle's metadata.json.
- `tests/e2e/graviscan-metadata-identity.e2e.ts` (new) — full flow: detect 2 mock scanners, see test-scan thumbnails, type plate barcodes, click Start Scan, see GxP modal with all the right fields, confirm, verify metadata.json carries the right scanner_firmware_serial + plate_barcode mapping.

**Affected guardrails:**

- This PR touches `src/renderer/`, so the parent (not a subagent) MUST `Read` at minimum 3 PNGs from `tests/e2e/screenshots/` after `npm run test:e2e:smoke`. Strong reason: the entire UX is visual.

## Non-Goals

- **No retroactive metadata edits** for already-written metadata.json files. The mid-session edit flow only affects future cycles.
- **No automatic plate-orientation detection from QR codes.** Pilot referenced this (`680a2d9`, `5f4de4a`); deferred unless lab managers request it. Test-scan thumbnails serve a similar role.
- **No mid-session replug detection.** Tracked separately as #217.
- **No mandatory `display_name`** (hard gate). The soft gate is the choice — we show the disambiguation problem at the right moment but never block the operator from proceeding.
- **No restoration of the pilot's monolithic single-scrolling-page layout.** The route-based decomposition is correct; we restore content (rich identity, thumbnails, color) within the routes, not architecture.
- **No `metadata.csv` per-wave export** (the pilot had this at `47330db:src/main/graviscan-handlers.ts:1080-1118`). Per-image metadata.json supersedes; if labs want CSV export later, it's a follow-up.
- **No cryptographic signing or SHA-256 checksum of metadata.json.** Out of scope; defer to follow-up if labs request it.
