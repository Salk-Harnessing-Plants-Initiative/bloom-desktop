## Why

The Camera Settings page uses a full-width `p-8` layout with no max-width constraint, causing its content to stretch edge-to-edge. Every other primary page either uses a max-width centered container (CaptureScan: `max-w-7xl mx-auto`, MachineConfiguration: `max-w-4xl mx-auto`) or sits within the Layout wrapper's `p-6` padding. This makes Camera Settings visually inconsistent — the live preview and settings form spread out unnaturally on wide screens while other pages are visually centered.

This was not a regression — Camera Settings was originally built without centering and was never updated as the layout pattern solidified across other pages.

## What Changes

- **Camera Settings page** adopts `max-w-7xl mx-auto` centered container with `bg-gray-50` background, matching CaptureScan's pattern (both are two-panel pages with live preview)
- **Padding and shadow** normalized to `p-6` / `shadow-sm` for consistency with CaptureScan

No functional changes — only layout/styling adjustments.

## Impact

- Affected specs: none currently (no UI layout consistency spec exists; this change adds one)
- Affected code:
  - `src/renderer/CameraSettings.tsx` — root container class changes only
- Does NOT affect: any other page, functionality, IPC, database, Python code, or tests
- Risk: very low — CSS-only change, no logic changes

## Acceptance Criteria

1. Camera Settings page content is horizontally centered with a max-width container
2. Visual alignment matches CaptureScan page layout pattern
3. Live preview and settings form remain side-by-side on large screens
4. No visual regressions on small screens (responsive breakpoint preserved)
5. All existing E2E and unit tests pass without modification
