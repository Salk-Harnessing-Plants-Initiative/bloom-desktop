## Why

bloom-desktop needs runtime scanner mode selection before GraviScan code can be integrated. Currently the app is hardcoded to CylinderScan — there is no concept of scanner mode. This is Increment 0b of the GraviScan integration plan (epic #126).

## What Changes

- **Add `scanner_mode` field** to `MachineConfig` (`'cylinderscan' | 'graviscan'`), persisted in `~/.bloom/.env`
- **Machine Config wizard requires mode selection** as the first step — "What scanner hardware is attached to this machine?"
- **Machine Config page shows mode-specific fields** — CylinderScan fields (camera IP, frames, rotation speed) hidden in GraviScan mode, and vice versa when GraviScan fields arrive later
- **Add `useAppMode()` hook** that reads mode from main process via IPC, gates rendering until resolved
- **Conditional routing in `App.tsx`** — capture routes gated on mode, browse routes always visible, catch-all redirect
- **Conditional nav in `Layout.tsx`** — capture nav items gated on mode
- **Mode-aware Home page** — workflow steps specific to configured mode (CylinderScan or GraviScan)
- **Update E2E test helper** to pre-seed `SCANNER_MODE=cylinderscan`

Part of GraviScan epic #126.

## Impact

- Affected specs: `scanning` (adds mode-aware routing), `machine-configuration` (adds scanner mode field)
- Affected code:
  - `src/main/config-store.ts` — add `scanner_mode` field, default, validation
  - `src/main/main.ts` — add `config:get-mode` IPC handler
  - `src/main/preload.ts` — expose `config.getMode()` to renderer
  - `src/types/electron.d.ts` — add `getMode()` to ConfigAPI type
  - `src/renderer/App.tsx` — conditional routes with `useAppMode()` gate
  - `src/renderer/Layout.tsx` — conditional nav items, remove hardcoded "Cylinder Scanner" subtitle
  - `src/renderer/Home.tsx` — mode-aware workflow steps (reusable WorkflowStep component)
  - `src/renderer/MachineConfiguration.tsx` — scanner mode selector, mode-conditional field sections
  - `tests/e2e/helpers/bloom-config.ts` — pre-seed `SCANNER_MODE`
  - New: `src/renderer/hooks/useAppMode.ts`
  - New: `src/renderer/components/WorkflowSteps.tsx`
- Does NOT affect: Python code, camera/DAQ/scanner process files, database schema, existing scan functionality
