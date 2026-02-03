## Why

Currently, bloom-desktop has no configuration system. Hardware settings (camera IP, scanner name) and API credentials are either hardcoded or non-existent. The pilot application uses a YAML file (`~/.bloom/desktop-config.yaml`) that admins must manually edit, which is error-prone and not user-friendly. A GUI-based configuration system will:

1. Allow lab managers to configure scanning stations without editing files
2. Protect configuration from accidental changes by phenotypers
3. Store API credentials securely for Bloom cloud upload
4. Display scanner identity in the UI for station identification

## What Changes

- **ADDED**: Machine Configuration UI page (`/machine-config`) with admin-only access
- **ADDED**: Config store module for persisting machine settings to `~/.bloom/config.json`
- **ADDED**: Credentials store for sensitive API credentials in `~/.bloom/.env`
- **ADDED**: Keyboard shortcut (`Ctrl+Shift+,`) to access hidden configuration page
- **ADDED**: Scanner name display in sidebar footer
- **ADDED**: First-run detection with auto-redirect to configuration
- **ADDED**: IPC handlers for config operations
- **MODIFIED**: CaptureScan to use `scanner_name` from config instead of hardcoded value
- **MODIFIED**: Layout.tsx to display scanner name from config

## Impact

- Affected specs: New `machine-configuration` capability
- Affected code:
  - `src/main/config-store.ts` (new)
  - `src/main/main.ts` (IPC handlers, keyboard shortcut)
  - `src/main/preload.ts` (config API)
  - `src/renderer/MachineConfiguration.tsx` (new)
  - `src/renderer/App.tsx` (route)
  - `src/renderer/Layout.tsx` (scanner name display)
  - `src/renderer/CaptureScan.tsx` (use config values)
