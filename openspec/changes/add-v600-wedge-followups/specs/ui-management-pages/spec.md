## ADDED Requirements

### Requirement: DPI Dropdown Restricted to Validated Set

The `GRAVISCAN_RESOLUTIONS` constant in `src/types/graviscan.ts` SHALL
be restricted to the V600-validated DPI set:

```typescript
export const GRAVISCAN_RESOLUTIONS = [
  200, 400, 600, 800, 1200, 1600,
] as const;
```

This removes `3200` and `6400` from operator-selectable values, which
were neither validated against the V600 wedge envelope nor
empirically tested by the investigation. The `(recommended)` tag on
`1200` SHALL be preserved in the DPI dropdowns on
`src/renderer/ConfigureScanner.tsx` and
`src/renderer/components/graviscan/ScannerConfigSection.tsx`.

#### Scenario: Dropdown offers only validated values

- **GIVEN** the Configure Scanner page is open
- **WHEN** the DPI dropdown is rendered
- **THEN** the available options SHALL be exactly
  `[200, 400, 600, 800, 1200, 1600]` (in that order)
- **AND** `3200` and `6400` SHALL NOT be selectable

#### Scenario: 1200 dpi remains marked as recommended

- **GIVEN** the DPI dropdown is rendered
- **WHEN** the operator inspects the options
- **THEN** the `1200` option SHALL be labeled with `(recommended)`

#### Scenario: GRAVISCAN_RESOLUTIONS constant is the single source

- **GIVEN** the dropdown is sourced from `GRAVISCAN_RESOLUTIONS`
- **WHEN** the constant is modified
- **THEN** both dropdown locations SHALL reflect the new value (the
  constant is the single source of truth — no hard-coded option lists
  in the JSX)

---

### Requirement: Per-Scanner Remove Button on Configure Scanner Page

The Configure Scanner page SHALL render a `Remove` button per scanner
row. When clicked, the button SHALL:

1. Call `window.electron.graviscan.disableScanner(scannerId)` (which
   in turn invokes the `graviscan:disable-scanner` IPC; see
   machine-configuration capability).
2. Optimistically remove the row from the visible scanner list (the
   IPC's success will be confirmed by a subsequent
   `get-scanner-status` refresh, which filters `enabled=true`).
3. Show a toast or inline confirmation on success/failure.

The button SHALL be visible on every scanner row, regardless of
whether the row is currently in `disconnected`, `connecting`, or
`ready` state. The button SHALL be disabled (grayed) while a scan is
actively running on that scanner.

#### Scenario: Remove button appears on each scanner row

- **GIVEN** the Configure Scanner page lists N scanner rows
- **WHEN** the rows are rendered
- **THEN** each row SHALL show a Remove button

#### Scenario: Clicking Remove disables the scanner

- **GIVEN** a scanner row for scanner_id `A` is displayed
- **WHEN** the operator clicks the Remove button
- **THEN** `window.electron.graviscan.disableScanner('A')` SHALL be
  called
- **AND** on success, the row SHALL disappear from the scanner list
  on the next status refresh

#### Scenario: Remove button is disabled during active scan

- **GIVEN** a scanner row for scanner_id `A` is in `scanning` status
- **WHEN** the row is rendered
- **THEN** the Remove button SHALL be disabled (`disabled` attribute
  set) and visually grayed
- **AND** clicking it SHALL NOT call the disable-scanner IPC

#### Scenario: Failure shows an error message

- **GIVEN** the disable-scanner IPC returns `{ ok: false, error: msg }`
- **WHEN** the response arrives
- **THEN** the UI SHALL display the error message via the existing
  toast pattern (`useToast.showToast({type: 'error', ...})`)

#### Scenario: Success shows a confirmation toast

- **GIVEN** the disable-scanner IPC returns `{ ok: true }`
- **WHEN** the response arrives
- **THEN** the UI SHALL display a success toast with copy
  `"Scanner removed."` via the existing toast pattern
  (`useToast.showToast({type: 'success', message: 'Scanner removed.'})`)
- **AND** the scanner list SHALL refresh on the next
  `get-scanner-status` poll to confirm the removal

---

### Requirement: Predictive Cadence Warning on Continuous-Scan Form

The continuous-scan form SHALL render an amber warning banner BEFORE the operator clicks Start when the predicted per-cycle wall time exceeds the configured interval.

The prediction uses a pure function `estimateCycleSeconds()` (located
in `src/renderer/lib/cadenceEstimator.ts` or similar) that takes:

- `platesPerScanner` (derived from each scanner's `grid_mode`)
- `scannerCount`
- `dpi`
- `regionMm` (width and height in millimeters)

…and returns an estimated wall-clock seconds per cycle, calibrated
against the empirical numbers from the V600 wedge investigation
summary (Section 3): 2 plates × 5 scanners × 1200 dpi × 140×140 mm
≈ 300 s honored, 4 plates × 5 scanners × 1200 dpi × 140×140 mm
≈ 418 s back-to-back.

The banner SHALL:

- Use the existing amber Tailwind classes
  (`bg-amber-50 border-amber-300 text-amber-800`) consistent with
  other warning banners on this page.
- Display copy that names the predicted minutes, the configured
  interval, and the three remediation paths (fewer plates, lower DPI,
  smaller region).
- Disappear when the configuration changes such that the prediction
  fits the interval.
- Re-evaluate reactively when DPI, platesPerScanner, or scannerCount
  changes.

The existing reactive `overtime` banner (which fires AFTER configured
duration is exceeded) SHALL remain unchanged; this requirement adds a
parallel predictive banner, not a replacement.

#### Scenario: Banner appears when prediction exceeds interval

- **GIVEN** the form has `platesPerScanner=4`, `scannerCount=5`,
  `dpi=1200`, `regionMm={140,140}`, `intervalMinutes=5`
- **WHEN** the component renders
- **THEN** `estimateCycleSeconds()` SHALL return a value > 300
- **AND** the amber warning banner SHALL be visible
- **AND** the banner copy SHALL include the predicted minutes and
  the three remediation paths

#### Scenario: Banner is hidden when prediction fits interval

- **GIVEN** the form has `platesPerScanner=2`, `scannerCount=5`,
  `dpi=1200`, `regionMm={140,140}`, `intervalMinutes=5`
- **WHEN** the component renders
- **THEN** `estimateCycleSeconds()` SHALL return a value ≤ 300
- **AND** the amber warning banner SHALL NOT be visible

#### Scenario: Banner reacts to DPI change

- **GIVEN** the banner is currently visible for `dpi=1200`
- **WHEN** the operator changes `dpi` to `800` (lower)
- **AND** the new prediction fits the interval
- **THEN** the banner SHALL disappear on the next render

#### Scenario: Banner reacts to grid_mode change

- **GIVEN** the banner is currently visible for 4-plate config
- **WHEN** the operator changes platesPerScanner from 4 to 2
- **AND** the new prediction fits the interval
- **THEN** the banner SHALL disappear on the next render

#### Scenario: Overtime banner remains unchanged

- **GIVEN** a continuous scan has started and exceeded the configured
  duration
- **THEN** the existing reactive `overtime` banner
  (`ScanControlSection.tsx:277-284`) SHALL continue to display as it
  does today — the new predictive banner does not replace it
