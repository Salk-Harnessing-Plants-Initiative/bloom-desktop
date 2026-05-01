# Tasks — surface-scanner-identity-on-metadata-page

> **Discipline:** Strict TDD. Section 1 writes failing tests. Section 2 makes them pass. Section 3 verifies end-to-end.
>
> **Order-of-shipment:** This proposal lands AFTER `add-scanner-firmware-serial-identity`. Sections that depend on Proposal 2 (auto-rebind toasts, firmware_serial display in BrowseGraviScans, GxP modal showing serials) are explicitly tagged `[depends-on-P2]`. Without P2 they degrade gracefully (no serial column; toast omits serial-fragment text).

## 1. Tests (red phase)

### 1a. Pilot-component restoration tests

- [ ] 1.1 Add `tests/unit/components/ImageLightbox.test.tsx`:
  - Renders src and caption when provided
  - Esc key calls `onClose`
  - Left/Right arrows call `onPrev`/`onNext` when provided
  - Click outside the image area calls `onClose`
- [ ] 1.2 Add `tests/unit/components/ScanPreview.test.tsx`:
  - Given `scanners: [...]` with `plateImages: { '00': dataUri }`, the preview renders the dataUri thumbnail at the correct grid position for 2grid (1×2) and 4grid (2×2) layouts
  - Click on a thumbnail calls `onImageClick(uri, plateIndex)`
  - Empty plate cell renders a placeholder (no image, no error)
  - `scanningPlateIndex: '00'` overlays a spinner on cell `00`
  - Status pill renders "Scanning"/"Complete"/"<n>/<total>"/"Ready"/"Error" per state contract
- [ ] 1.3 Add `tests/unit/components/ScannerPanel.test.tsx`:
  - Online + Busy LED indicators render distinct color classes for online/offline and idle/busy states
  - Color-coded background classes match state (red for error, green for complete, amber for waiting, white for idle)
  - Progress bar width follows `progress` prop
  - The component derives `enabled` from `scannerAssignments[i].scannerId !== null` (NOT from a `scanner.enabled` field, which was removed in `fix-graviscan-scan-session-state` task 2.7)

### 1b. Identity-display + UX-utility tests

- [ ] 1.4 Add `tests/unit/utils/usb-port-color.test.ts`:
  - `usbPortToHueAndStyle('1-1')` returns a stable `{ color, borderStyle }` pair
  - Same input → same output pair across calls
  - **Pair-uniqueness for all 16 table entries** (`'1-1'` through `'1-4'`, `'2-1'` through `'2-4'`, `'3-1'` through `'3-4'`, `'4-1'` through `'4-4'`): given these 16 strings, no two return the same `(color, borderStyle)` pair
  - Colors come from the Wong 8-color colorblind-safe palette (assert each returned color matches one of the 8 hex values)
  - Border-styles come from `{ 'solid', 'dashed', 'dotted', 'double' }`
  - **Yellow exclusion for active panels**: `usbPortToHueAndStyle` SHALL NEVER return color hex `#F0E442` for any of the 16 table entries (yellow is excluded from the active scanner-color set due to low contrast against white). Test by iterating all 16 entries and asserting `result.color.hex !== '#F0E442'`.
  - **FNV-1a fallback skips yellow**: for an unknown port that would naturally hash to color index 4 (yellow), the fallback SHALL re-roll to color index 5. Test with a port string whose FNV-1a hash maps to colorIdx === 4 BEFORE the skip — verify post-skip colorIdx === 5.
  - Empty-port input falls back to hashing a composite key when provided
- [ ] 1.5 Extend `tests/unit/graviscan/Metadata.test.tsx` (new if not present):
  - The H3 header renders `display_name`, `name`, AND `usb_port` (NOT just the raw scannerId)
  - When `display_name` is null, falls back to `slot`
  - When two scanners share `(name, vendor_id, product_id)`, both rows show distinct `usb_port` text
  - **Banner appears** when `scannerAssignments.some(a => a.scannerId === '')`: text contains "Save scanner configuration"
  - **PlateGridEditor inputs are disabled** while the banner is visible (no input accepts keystrokes)
  - The empty-state message split: when no experiment selected, message says "Select an experiment"; when no saved scanners (assignedScannerIds.length === 0), message says "Go to Scanner Config" and renders a button linking to `/scanner-config`
- [ ] 1.6 Extend `tests/unit/graviscan/ScannerConfig.test.tsx` (new if not present):
  - `display_name` editor is rendered as an inline `<input>` next to each scanner row
  - Editing the input and clicking Save sends the new `display_name` (not `undefined`) in the IPC payload
  - When ≥2 detected scanners share `(name, vendor_id, product_id)` AND none have a custom `display_name`, the soft-gate banner appears above the Save button
  - Clicking "Suggest names" pre-fills inputs with `"USB <port> (<descriptor>)"` from the suggested-names generator
  - Clicking "Skip" dismisses the banner; Save proceeds with default `display_name: undefined`
  - On subsequent saves, the input is **pre-filled with the saved display_name** (no blank fields)
- [ ] 1.7 Add `tests/unit/components/PlateGridEditor.test.tsx` (extend if exists):
  - When `experiment.isGraviMetadata === true` AND `availableBarcodes` is non-empty, the barcode field is a `<select>` populated with those barcodes (NOT a free-text `<input>`)
  - The genotype sidecar renders alongside the dropdown when a barcode is selected
  - When `experiment.isGraviMetadata === false`, the barcode field is a free-text `<input>` (fallback)
  - The card has a `border-l-4` accent matching the scanner's usb_port hue (use the utility from 1.4)
- [ ] 1.8 Extend `tests/unit/hooks/usePlateAssignments.test.ts`:
  - **Regression test (forward mapping)**: after a `scannerAssignmentsKey` flip from `''` → real UUID, `plantBarcode`, `transplantDate`, and `customNote` typed under the `''` key are PRESERVED into the new UUID-keyed slot. (Today they're wiped to defaults.)
  - **Inverse-leak safety test**: after a `scannerAssignmentsKey` flip from `'uuid-A'` → `'uuid-B'` (replacement scenario at the same usb_port), `plantBarcode`/`transplantDate`/`customNote` in the new `'uuid-B'` slot SHALL be the DB-loaded defaults (typically `null`), NOT carried over from `'uuid-A'`. The forward-mapping rule is "copy from prior slot ONLY when prior key was `''`".
  - **Forward-mapping race coordination test**: mock `database.graviscanPlateAssignments.upsert` to be artificially slower than the experiment-load `findMany` call. Assert that after the placeholder→UUID flip, the forward-mapped values survive — i.e., the experiment-load DB-read does NOT clobber the forward-mapped state with empty defaults. The implementation MUST coordinate via either (a) writing forward-mapped values to DB before the experiment-load read fires, or (b) a shared ref/flag that lets the experiment-load skip the read for the just-flipped key.

### 1c. GxP-modal + Identify-button tests

- [ ] 1.9 Add `tests/unit/graviscan/StartScanConfirmModal.test.tsx` (new):
  - With ≥2 enabled scanners, the modal is rendered when Start Scan is clicked
  - The modal lists each scanner's `display_name`, `usb_port`, `firmware_serial` (when populated), and last test-scan thumbnail
  - The modal lists all selected plates per scanner with plate_index, barcode, transplant_date, custom_note
  - The "Start scan" button is disabled until the "I have verified the physical scanners and plate positions match this list" checkbox is ticked
  - Clicking "Start scan" with the checkbox ticked dispatches the IPC `gravi.startScan`
  - With 1 enabled scanner, the modal is auto-skipped (Start Scan goes directly to IPC)
- [ ] 1.10 Extend `tests/unit/hooks/useTestScan.test.ts`:
  - New API: `handleIdentifyScanner(scannerId)` runs a single-plate Test Scan for that scanner only
  - The result thumbnail pulses for ~3s in `ScanPreview` (verify a state-flag for the pulse is set, then unset after a timer)

### 1d. Integration + E2E

- [ ] 1.11 Add `tests/integration/update-session-metadata.test.ts`:
  - Start a 2-cycle scan
  - Between cycles 1 and 2, dispatch `gravi.updateSessionMetadata({...})` with a new `plant_barcode`
  - Cycle 2's metadata.json reflects the new value; cycle 1's metadata.json is unchanged
  - Verify a `GraviScannerBinding` row was written with the manual-confirm reason (depends-on-P2; if P2 not landed, just assert the IPC succeeded)
- [ ] 1.12 Add `tests/e2e/graviscan-metadata-identity.e2e.ts`:
  - Detect 2 mock scanners (mock-mode helper sets distinct `usb_port` values)
  - Save (banner does NOT appear because mock scanners use the same name); type display_names via the editor
  - Run Test All → ScanPreview shows thumbnails per scanner
  - Navigate to Metadata page → H3 headers show display_name + USB port + scanner name
  - Type plate barcodes; verify they persist through navigation away and back
  - Click Start Scan → GxP modal appears, shows ScanPreview cards + plate lists
  - Tick the verification checkbox; click Start scan
  - Wait for cycle 1 completion; verify metadata.json contains the typed plate_barcode + correct scanner_name

### 1e. Gate (red phase)

- [ ] 1.13 Run new unit + integration suites; confirm RED for behavioral reasons:
  ```bash
  npm run test:unit
  npm run test:integration
  ```
- [ ] 1.14 Gate: `npx tsc --noEmit && npm run lint && npm run format:check` — clean.

## 2. Implementation (green phase)

### 2a. Restore pilot components

- [ ] 2.1 Restore `src/renderer/components/ImageLightbox.tsx` from `47330db:src/renderer/components/ImageLightbox.tsx`. No code changes needed; pure React.
- [ ] 2.2 Restore `src/renderer/components/ScanPreview.tsx` from `47330db:src/renderer/components/ScanPreview.tsx`. Verify it compiles against current types (`ScannerAssignment`, `PlateAssignment`, `GridMode`, `formatPlateIndex`). Adapt any small breakage.
- [ ] 2.3 Restore `src/renderer/components/ScannerPanel.tsx` from `47330db:src/renderer/components/ScannerPanel.tsx`. **Required adaptations**:
  1. Replace the removed `scanner.enabled` field with a derivation. **CRITICAL: derive by `usbPort`, NOT by `scannerId`.** Using `scannerAssignments.some(a => a.scannerId === scanner.scannerId)` would return `true` for any panel whose detected scanner_id is `''` whenever ANY assignment has `scannerId === ''` — silently regressing the placeholder collision Proposal 1 just fixed. Correct form: `scannerAssignments.some(a => a.usbPort === scanner.usbPort)`. This relies on `ScannerPanelState.usbPort` being populated (per Proposal 1 task 2.15).
  2. Add `scannerAssignments: ScannerAssignment[]` as a new prop. Pass through from the call site (`GraviScan.tsx`).
  3. Wire up the existing `onToggleEnabled` prop from the pilot. Today's `GraviScan.tsx` checkbox-toggle handler at lines 302-313 already exists; the ScannerPanel restoration moves the visual chrome around the existing checkbox without changing the toggle semantics. **Verify**: `GraviScan.tsx`'s checkbox is replaced by ScannerPanel's; do not duplicate.

### 2b. UX utilities

- [ ] 2.4 Add `src/utils/usb-port-color.ts` with a **table-driven (color, border-style) pairing** for the 8 most-likely USB port strings, with hash-fallback for unknown ports. Round-2 review caught that the previous hash-based approach produced 3 collisions on the test inputs (`'1-1'/'2-1'`, `'1-2'/'2-2'`, `'1-3'/'2-3'`). A table-driven primary path makes pair-uniqueness for known ports a property of the data, not a property of a hash function.
  ```ts
  // Wong's 8-color colorblind-safe palette (https://davidmathlogic.com/colorblind/)
  const PALETTE = [
    { hex: '#000000', label: 'black' },
    { hex: '#E69F00', label: 'orange' },
    { hex: '#56B4E9', label: 'sky-blue' },
    { hex: '#009E73', label: 'bluish-green' },
    { hex: '#F0E442', label: 'yellow' },
    { hex: '#0072B2', label: 'blue' },
    { hex: '#D55E00', label: 'vermillion' },
    { hex: '#CC79A7', label: 'reddish-purple' },
  ] as const;
  const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double'] as const;

  // Explicit table extended to 16 entries covering bus 1-4 × port 1-4 (the
  // realistic range for multi-hub lab setups). Each row's (color, style)
  // pair is hand-chosen to be unique within this table. Round-3 review
  // caught that an 8-entry table left bus-3+ scanners colliding with bus-2
  // entries via the FNV-1a fallback.
  const PORT_TABLE: Record<string, { colorIdx: number; styleIdx: number }> = {
    '1-1': { colorIdx: 0, styleIdx: 0 },  // black,         solid
    '1-2': { colorIdx: 1, styleIdx: 0 },  // orange,        solid
    '1-3': { colorIdx: 2, styleIdx: 0 },  // sky-blue,      solid
    '1-4': { colorIdx: 3, styleIdx: 0 },  // bluish-green,  solid
    '2-1': { colorIdx: 5, styleIdx: 1 },  // blue,          dashed (NOT yellow — too low-contrast against white; round-3 contrast finding)
    '2-2': { colorIdx: 6, styleIdx: 1 },  // vermillion,    dashed
    '2-3': { colorIdx: 7, styleIdx: 1 },  // reddish-purple, dashed
    '2-4': { colorIdx: 0, styleIdx: 1 },  // black,         dashed
    '3-1': { colorIdx: 1, styleIdx: 2 },  // orange,        dotted
    '3-2': { colorIdx: 2, styleIdx: 2 },  // sky-blue,      dotted
    '3-3': { colorIdx: 3, styleIdx: 2 },  // bluish-green,  dotted
    '3-4': { colorIdx: 5, styleIdx: 2 },  // blue,          dotted
    '4-1': { colorIdx: 6, styleIdx: 3 },  // vermillion,    double
    '4-2': { colorIdx: 7, styleIdx: 3 },  // reddish-purple, double
    '4-3': { colorIdx: 0, styleIdx: 3 },  // black,         double
    '4-4': { colorIdx: 5, styleIdx: 3 },  // blue,          double
  };
  // Note: PALETTE index 4 (`#F0E442` yellow) is SKIPPED in the table —
  // round-3 WCAG check found yellow is 1.32:1 contrast against white, well
  // below the 3:1 non-text minimum and effectively invisible on `border-l-4`.
  // The yellow swatch is preserved in PALETTE (so a future light-themed UI
  // could use it where contrast is acceptable) but is excluded from the
  // active scanner-color table. Unknown ports fall through to FNV-1a hash;
  // if that hash lands on color index 4 (yellow), the fallback re-rolls
  // by incrementing the colorIdx until it lands on a non-4 value.

  export function usbPortToHueAndStyle(port: string | null | undefined, fallbackKey?: string): {
    color: { hex: string; label: string };
    borderStyle: string;
  } {
    const key = port && port.length > 0 ? port : (fallbackKey ?? '');
    const hit = PORT_TABLE[key];
    if (hit) {
      return { color: PALETTE[hit.colorIdx], borderStyle: BORDER_STYLES[hit.styleIdx] };
    }
    // Unknown port: hash fallback. Use FNV-1a for better avalanche than `*31`.
    // SKIP yellow (palette index 4) because of low contrast against white.
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash ^ key.charCodeAt(i)) * 0x01000193) >>> 0;
    }
    let colorIdx = hash % PALETTE.length;
    if (colorIdx === 4) colorIdx = (colorIdx + 1) % PALETTE.length;  // skip yellow
    const styleIdx = (hash >>> 8) % BORDER_STYLES.length;
    return { color: PALETTE[colorIdx], borderStyle: BORDER_STYLES[styleIdx] };
  }
  ```
- [ ] 2.4a **Tailwind safelist for arbitrary-value border colors.** Add a `safelist` block to `tailwind.config.js` that explicitly lists every hex color border class the runtime palette can produce (so Tailwind's JIT compiler emits the CSS rules even though the classes are computed at runtime, not present in source). Also safelist the four border-style utilities and the `border-l-4` width utility:
  ```js
  // tailwind.config.js
  module.exports = {
    // ... existing config ...
    safelist: [
      // ... existing safelist entries ...
      'border-l-4',
      'border-solid', 'border-dashed', 'border-dotted', 'border-double',
      'border-[#000000]', 'border-[#E69F00]', 'border-[#56B4E9]', 'border-[#009E73]',
      'border-[#F0E442]', 'border-[#0072B2]', 'border-[#D55E00]', 'border-[#CC79A7]',
    ],
  };
  ```
  Add a smoke test or build-time assertion (the e2e screenshot capture is sufficient) that the compiled CSS contains `.border-\[\#E69F00\]` (or equivalent escaped form).
- [ ] 2.5 Add `src/utils/scanner-name-suggestions.ts`:
  ```ts
  export function suggestNamesFromTopology(scanners: DetectedScanner[]): string[] {
    return scanners.map((s) => `USB ${s.usb_port} ${descriptorFor(s.usb_port)}`);
  }
  function descriptorFor(port: string): string {
    // Cheap heuristic; refine based on lab feedback. Falls back to "" when port is unknown.
    const map: Record<string, string> = { '1-1': '(back-left)', '1-2': '(back-right)', '1-3': '(front-left)', '1-4': '(front-right)' };
    return map[port] ?? '';
  }
  ```

### 2c. Metadata.tsx integration

- [ ] 2.6 Replace the `<h3>Scanner: {scannerId}</h3>` at `src/renderer/graviscan/Metadata.tsx:258-260` with a header that renders `display_name ?? slot`, `scanner.name`, `usb_port`, and (when Proposal 2 is landed) a short serial fragment. Add `usbPortToHue(scanner.usb_port)` as a `border-l-4` accent on the section card.
- [ ] 2.7 Add a banner above the per-scanner sections that renders when `scannerAssignments.some(a => a.scannerId === '' || a.scannerId === null)`. Disable all `PlateGridEditor` inputs (via a `disabled` prop) while the banner is visible.
- [ ] 2.8 Wire `onTransplantDateChange` and `onNoteChange` props on `Metadata.tsx:266-268` (currently only `onBarcodeChange` is passed). Use the existing `usePlateAssignments.handlePlateTransplantDate` and `handlePlateCustomNote` (add these methods if they don't exist).
- [ ] 2.9 Replace the conflated empty-state message at `Metadata.tsx:273-278` with a discriminated check: `if (!selectedExperiment) return "Select an experiment";` else `if (assignedScannerIds.length === 0) return <go-to-scanner-config-button />` else render the per-scanner sections.
- [ ] 2.10 Render `<ScanPreview>` (per-scanner thumbnail card) above the per-scanner plate-grid editor section so the operator sees the test-scan thumbnail next to the fields they're typing.

### 2d. usePlateAssignments forward-mapping

- [ ] 2.11 Modify `src/renderer/hooks/usePlateAssignments.ts:105-143`. Instead of `setScannerPlateAssignments(newAssignments)` wiping the state on key flip, build `forwardMapped` by:
  1. Iterating new `scannerAssignments`
  2. For each, looking up the previous slot under the pre-flip `''` slot **only** (NOT the previous UUID slot — that path is the inverse-leak hazard)
  3. Preserving `plantBarcode`, `transplantDate`, `customNote` from the `''` slot when the new key is a real UUID
  4. Filling defaults only when no `''`-keyed prior data exists
  5. **Persist the forward-mapped values to DB via `database.graviscanPlateAssignments.upsert` synchronously inside the same effect**, BEFORE the experiment-load effect's DB-read fires. Use a `pendingUpsertsRef: React.MutableRefObject<Promise<void>[]>` to track in-flight upserts; the experiment-load effect awaits this promise array before reading.
- [ ] 2.11a **Coordinate with the experiment-load effect (lines 146-325).** Today both effects key on `scannerAssignmentsKey` and fire concurrently. After 2.11 lands, the experiment-load effect MUST `await Promise.all(pendingUpsertsRef.current.filter(p => p.experiment_id === selectedExperiment).map(p => p.promise))` before its `findMany`. (Round-3 review correctly rejected the "forwardMappingDoneRef flag" alternative — a `useRef` flag set after async work cannot trigger a re-fire of an effect that's already running, so the flag-based approach is broken.)
- [ ] 2.11b **Inverse-leak guard.** Add an explicit comment in the forward-mapping code: `// We do NOT copy from a prior real UUID slot to the new UUID slot — that would silently inherit plate metadata across scanner replacements (RMA, accidental swap with identical-model unit). Only the placeholder '' → real UUID transition copies forward.`
- [ ] 2.11c **`pendingUpsertsRef` cleanup story.** Each upsert added to the ref SHALL be cleaned up after it resolves so the array does not grow unbounded across the session (192 upserts/session × N experiments). Pattern: each pushed entry attaches a `.finally(() => removeFromRef(entry))` that splices itself out of `pendingUpsertsRef.current` once the promise settles (success OR rejection). Add a unit test asserting `pendingUpsertsRef.current.length === 0` after a sequence of N flips when all upserts have resolved.
- [ ] 2.12 Add unit tests per task 1.8 confirming forward-mapping, inverse-leak safety, AND race coordination. Run as part of 2m gate.

### 2e. ScannerConfig display_name editor + soft gate

- [ ] 2.12a **Extend `ScannerAssignment` type with `display_name`.** Edit `src/types/graviscan.ts:341-346`. Add `displayName: string | null` to the interface. Update `createEmptyScannerAssignment` (line 377) to default to `null`. Update `buildAssignmentsFromDetection` in `useScannerConfig.ts:357-388` to populate `displayName` from the matched DB row (or `null` for fresh placeholders). Without this type extension, task 2.13's "Pre-fill with the saved `display_name` from `scannerAssignments[i].display_name`" cannot compile.
- [ ] 2.13 Add an inline `<input>` next to each scanner row's name in `src/renderer/graviscan/ScannerConfig.tsx`. Pre-fill with the saved `displayName` from `scannerAssignments[i].displayName` (newly added in 2.12a) or with `suggestNamesFromTopology(...)` on first save.
- [ ] 2.14 In `useScannerConfig.ts:572-581` (auto-save) and `ScannerConfig.tsx:92-114` (manual save), change `display_name: undefined` to `display_name: editedDisplayName ?? undefined` so the typed name is sent. The main-process `?? existing.display_name` fallback still preserves admin overrides when the field is left blank.
- [ ] 2.15 Detect "≥2 scanners share `(name, vendor_id, product_id)` AND none has a non-default custom display_name" and render the soft-gate banner above the Save button. Wire "Suggest names" / "Use bench labels…" / "Skip" actions to (a) populate display_name inputs from the topology, (b) open a small dialog for manual entry, (c) dismiss and proceed with current values.
- [ ] 2.15a **Banner reappearance behavior.** "Skip" SHALL dismiss the banner for the current session only (clear `sessionStorage` flag on next mount). The dialog opened by "Use bench labels…" SHALL include a "Don't show this again for this experiment" checkbox; ticking it SHALL store a per-experiment opt-out in `localStorage` keyed by `graviscan:displayNameBannerOptOut:<experiment_id>`. The banner check SHALL read both the per-experiment opt-out AND the per-session dismissal before deciding to render. Add a unit test for both branches.

### 2f. Identify-this-scanner button

- [ ] 2.16 Add `handleIdentifyScanner(scannerId)` to `useTestScan.ts`. Internally calls a single-plate Test Scan for that scanner only by constraining the scanners array to one. Verified: `useTestScan.ts:194-216` builds `scannerConfigs` from `assignedScanners` and the underlying `gravi.startScan({scanners})` IPC accepts an arbitrary array. **Concrete assertion:** add a unit test that `handleIdentifyScanner('uuid-A')` calls `gravi.startScan` exactly once with `params.scanners.length === 1` and `params.scanners[0].scannerId === 'uuid-A'`. No new IPC required.
- [ ] 2.17 Add an "Identify" button next to each scanner row in `ScannerConfig.tsx` (and optionally on Metadata.tsx for in-context disambiguation). On click: dispatch `handleIdentifyScanner(scannerId)`; set a pulse-state flag; clear the flag after 3s.
- [ ] 2.17a **Concurrency guard.** The Identify button SHALL be `disabled` whenever ANY of these is true: (a) `savingRef.current` is true (Save in flight), (b) `useTestScan.isTestingAll` is true (Test All Scanners running), (c) `useTestScan.pulsingScannerId` is set (another Identify is pulsing), (d) `useScanSession.isScanning` is true (an active scan session is in flight, including continuous-mode interval-waits — reachable via the new "Pause and edit metadata" affordance), **(e) `scanner.scannerId === '' || scanner.scannerId === null` (placeholder or unchecked scanner — Test Scan IPC would error or, worse, scan an arbitrary first-detected scanner if `scannerId` is empty-string)**. Add unit tests simulating each of the 5 concurrent/state conditions and asserting the button is disabled in each case.
- [ ] 2.18 In `ScanPreview.tsx`, accept a `pulsingScannerId?: string` prop and apply a `ring-4 ring-blue-400 animate-pulse` class when `scanner.assignment.scannerId === pulsingScannerId`. Wire this through.

### 2g. GxP-style Start Scan confirmation modal

- [ ] 2.19 Add `src/renderer/components/StartScanConfirmModal.tsx` (new):
  - Props: `scanners: ScannerPreviewData[]`, `plateAssignmentsByScanner`, `onConfirm`, `onCancel`
  - Renders a read-only ScanPreview card per scanner + a list of selected plates per scanner (plate_index + barcode + transplant_date + custom_note + genotype/accession when present)
  - "I have verified the physical scanners and plate positions match this list" checkbox; "Start scan" button disabled until ticked
  - "Cancel" button always available
  - **`onConfirm` SHALL pass a structured `confirmation_snapshot` object** containing `{ confirmed_at: ISO8601, confirmed_by: phenotyper_id, scanners: [...], plates: [...] }` capturing exactly what was rendered. The rendering function and the snapshot-builder MUST share data so the snapshot represents the EXACT visual state the operator confirmed.
- [ ] 2.20 In `src/renderer/graviscan/GraviScan.tsx`, before `handleStartScan` fires the IPC, check `scannerStates.filter(s => isEnabled(s)).length`. If ≥2, render the modal; gate the IPC behind the modal's `onConfirm`. If <2, skip the modal AND set `confirmation_snapshot: null` in the IPC payload (single-scanner sessions have no operator confirmation).
- [ ] 2.20a **Schema migration for the snapshot persistence.** Edit `prisma/schema.prisma` to add `start_confirmation_snapshot Json?` column to the `GraviScanSession` model. Run `npx prisma migrate dev --name add_session_confirmation_snapshot`.
- [ ] 2.20b Update `src/main/graviscan/session-handlers.ts` to:
  1. Read `params.confirmation_snapshot` from the IPC payload (the renderer-supplied object MUST NOT include `confirmed_at` — the renderer's clock is untrusted).
  2. **Inject `confirmed_at: new Date().toISOString()` from the main process clock** before persisting.
  3. Compute `snapshot_sha256 = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')` over the post-injection snapshot.
  4. Persist the snapshot (with main-process `confirmed_at`) to `GraviScanSession.start_confirmation_snapshot`.
  5. Write a `GraviScannerBinding` audit row (Proposal 2's table) with `reason: 'manual:user-confirmed'`, `notes: 'session start confirmed; snapshot_sha256: <hex>'`, `bound_by: snapshot.confirmed_by`. The append-only constraint of GraviScannerBinding gives the snapshot tamper-evidence.
  Add unit tests:
  - **Test 2.20b-1**: column is populated for ≥2-scanner sessions; `null` for 1-scanner sessions.
  - **Test 2.20b-2**: `confirmed_at` in the persisted snapshot is the main-process value, NOT any renderer-supplied value (the renderer SHALL NOT include this field; if it does, main process overrides it).
  - **Test 2.20b-3**: a `GraviScannerBinding` row exists with the matching SHA-256 in `notes`.

### 2h. PlateGridEditor barcode dropdown

- [ ] 2.21 Modify `src/components/graviscan/PlateGridEditor.tsx`:
  - Accept new prop `availableBarcodes?: string[]` and `barcodeGenotypes?: Map<string, string>`
  - When `availableBarcodes` is provided, render the barcode field as a `<select>` populated with those values + an "(other)" option that falls back to `<input>`
  - Render the genotype next to the dropdown when a barcode is selected
  - Add `border-l-4 ${usbPortToHue(usbPort)}` accent to each card; pass `usbPort` as a prop
- [ ] 2.22 In `Metadata.tsx`, pass `availableBarcodes` and `barcodeGenotypes` from `usePlateAssignments` (already computed) into PlateGridEditor.

### 2i. BrowseGraviScans extra columns

- [ ] 2.23 Modify `src/renderer/graviscan/BrowseGraviScans.tsx` to surface `display_name`, `usb_port`, and `firmware_serial` (when populated) per scan row. Add small column headers and row cells. The data is already available via the `scanner` join in the query (`schema.prisma: GraviScan -> scanner: GraviScanner`).

### 2j. Reset confirmation modal

- [ ] 2.24 Modify `src/renderer/graviscan/ScannerConfig.tsx` to render a small confirmation modal on the Reset button. Modal text: "This will reset scanner configuration. Plate metadata is keyed by scanner_id and will be re-loaded automatically when you re-detect. [Cancel] [Reset]". Wire to the existing `handleResetScannerConfig`.

### 2k. Per-cycle metadata refresh IPC

- [ ] 2.25 Add IPC handler `gravi.updateSessionMetadata({ experiment_id, scanner_id, plate_index, plant_barcode?, transplant_date?, custom_note?, reason? })` in `src/main/graviscan/session-handlers.ts`. Mutates `coordinator.sessionContext.plateBarcodes/plateTransplantDates/plateCustomNotes` for the matching key. Writes a `GraviScannerBinding` audit row (Proposal 2) with `reason: 'manual:user-confirmed'` and a free-form note like `"updated plate ${plate_index} barcode mid-session"`.
- [ ] 2.26 Add a "Pause and edit metadata" affordance on `GraviScan.tsx` during continuous mode (between cycles). Opens a small panel with the per-scanner plate-grid editor. Saving dispatches the IPC.

### 2l. USB-topology tooltip

- [ ] 2.27 Add a small `<InfoTooltip>` component (or use a lightweight Tailwind-only popover) next to the `USB <port>` text in `ScannerConfig.tsx`. Tooltip body: "USB ports are numbered by your operating system based on physical hub topology. `1-1` is the first port on your first hub. We recommend labeling your physical USB hub ports with the included stickers so this is unambiguous."

### 2m. Gate (green phase)

- [ ] 2.28 Run the unit suite: `npm run test:unit` — all green.
- [ ] 2.29 Run integration: `npm run test:integration` — all green.
- [ ] 2.30 Run TypeScript and lint gates: `npx tsc --noEmit && npm run lint && npm run format:check` — clean.

## 3. Verification

- [ ] 3.1 Run smoke E2E: `npm run test:e2e:smoke`. Expected: pass; PNGs land in `tests/e2e/screenshots/`.
- [ ] 3.2 **Parent visual verification.** Renderer-touching change. The parent (NOT a subagent) MUST `Read`:
  - `tests/e2e/screenshots/cylinder-home.png`
  - `tests/e2e/screenshots/graviscan-scanner-config.png`
  - `tests/e2e/screenshots/graviscan-graviscan.png`
  - **`tests/e2e/screenshots/graviscan-metadata.png`** (NEW — this proposal heavily changes the Metadata page, so the smoke must capture and a parent must visually verify it.)
- [ ] 3.3 Run `tests/e2e/graviscan-metadata-identity.e2e.ts`. Expected: pass.
- [ ] 3.4 Run `tests/e2e/graviscan-port-swap.e2e.ts` (Proposal 2's E2E; smoke for non-regression). Expected: pass.
- [ ] 3.5 Run `tests/e2e/graviscan-scanner-config-save.e2e.ts` (Proposal 1's canary; smoke for non-regression). Expected: pass.
- [ ] 3.6 Run integration: `npm run test:integration`. Expected: pass.
- [ ] 3.7 Run Python: `npm run test:python`. Expected: pass.
- [ ] 3.8 Run OpenSpec validator: `openspec validate surface-scanner-identity-on-metadata-page --strict`. Expected: clean.
- [ ] 3.9 Dispatch the `openspec-review` subagent team against this proposal one more time. Address any BLOCKING findings.
- [ ] 3.10 **Manual UX verification by the lab manager** before merging to main: check that on a fresh install with two mock V850s, the Metadata page is unambiguous about which thumbnail belongs to which physical scanner. Screenshot both rows and compare.
- [ ] 3.11 Commit:
  ```
  feat(graviscan): scanner identity surfaces on metadata page (#203)

  Restores pilot's ScanPreview/ImageLightbox/ScannerPanel components.
  Adds rich identity headers (display_name + name + usb_port), color-
  coded panels, "Identify this scanner" button, soft-gate display_name
  editor with topology suggestions, GxP Start Scan confirmation modal
  for ≥2 scanners, barcode dropdown for graviMetadata experiments,
  per-cycle metadata refresh IPC, and BrowseGraviScans audit columns.

  Closes #203 (UX layer)
  Related: #182, #217 (mid-session replug, deferred)

  Spec: openspec/changes/surface-scanner-identity-on-metadata-page
  ```
- [ ] 3.12 Push and confirm CI green on Linux/macOS/Windows.
