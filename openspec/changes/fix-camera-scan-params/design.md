## Context

This change spans three process layers: Electron renderer (React UI), Electron main process (IPC + config store), and Python backend (camera hardware + DAQ). It corrects camera parameters for the Basler acA2000-50gm and adds configurable scan parameters.

bloom-desktop has not been deployed yet — only the pilot is in production. No backward compatibility with existing user data is required.

## Goals / Non-Goals

- Goals:
  - Camera Settings form shows only supported controls for the acA2000-50gm (Exposure, Gain, Gamma)
  - `num_frames` and `seconds_per_rot` configurable by admin in Machine Configuration
  - `gain` type, range, and default correct for Basler `GainRaw` (`IInteger`, 36-512)
  - Single source of truth for scan parameters: `MachineConfig` → passed into `DAQSettings` at scan time
- Non-Goals:
  - Per-experiment scan parameter overrides (future work, see #51)
  - Supporting multiple camera models (ace 2 API differences are out of scope)
  - Supabase RPC type fixes (separate from this change, tracked in #95)

## Decisions

### Decision: `num_frames` and `seconds_per_rot` live ONLY in MachineConfig

These are NOT added to `CameraSettings` or `DEFAULT_CAMERA_SETTINGS`. They are hardware station parameters, not camera image parameters.

- **Source of truth**: `MachineConfig` (persisted in `~/.bloom/.env`)
- **Runtime flow**: `MachineConfig` → CaptureScan component state → `scanner.initialize({ daq: { ...DEFAULT_DAQ_SETTINGS, num_frames: config.num_frames, seconds_per_rot: config.seconds_per_rot } })`
- **Metadata snapshot**: Values flow through `ScannerSettings.daq` into `buildMetadataObject()`, which reads `settings.daq.num_frames` and `settings.daq.seconds_per_rot`
- **Alternatives considered**: Adding to `CameraSettings` (rejected — they are DAQ/motor parameters, not camera parameters; creates triple source of truth)

### Decision: Remove `brightness`, `contrast`, `width`, `height` from `CameraSettings` entirely

Not just from the UI — from the TypeScript interface and Python dataclass too. These fields are dead code:

- `brightness`/`contrast`: `BslBrightness`/`BslContrast` not supported on ace Classic
- `width`/`height`: Never applied to hardware in `_configure_camera()`

Since bloom-desktop has no deployed users, there is no backward compatibility concern. The Prisma `Scan` model retains `brightness Float` and `contrast Float` columns — these will be populated with `0` (Basler identity values) at scan record creation time.

- **Alternatives considered**: Keeping fields as optional with default 0 (rejected — misleading to have dead fields in the interface)

### Decision: Gain range 36-512, integer, default 100

Based on the Basler ace GigE User's Manual (Table 19-20) for the acA2000-50gm with CMV2000 sensor:

- `GainRaw` is `IInteger` (Pylon GenICam type)
- Normal minimum: 36 (~1.0 dB)
- Maximum: 512 (24.0 dB)
- Conversion: `Gain_dB = 20 * log10(GainRaw / 32)`
- Pilot default: 100 (~9.9 dB)

### Decision: Practical bounds for scan parameters

- `num_frames`: 1-720 (720 = 10x default, 0.5° per frame, already very high resolution)
- `seconds_per_rot`: 2.0-120.0 (2s = near motor speed limit at 40kHz sampling; 120s = 2 minutes, reasonable max)

## Data Flow

```
~/.bloom/.env
  NUM_FRAMES=72
  SECONDS_PER_ROT=7.0
       │
       ▼
config-store.ts: loadEnvConfig()
  → MachineConfig { num_frames: 72, seconds_per_rot: 7.0, ... }
       │
       ▼
main.ts: IPC handler 'config:get'
  → returns { config: MachineConfig }
       │
       ▼
CaptureScan.tsx: useEffect on mount
  → loads config, stores num_frames & seconds_per_rot in component state
       │
       ▼
handleStartScan()
  → scanner.initialize({
      camera: cameraSettings,
      daq: { ...DEFAULT_DAQ_SETTINGS,
             num_frames: config.num_frames ?? 72,
             seconds_per_rot: config.seconds_per_rot ?? 7.0 },
      num_frames: config.num_frames ?? 72,
      output_path: ...,
      metadata: { ... }
    })
       │
       ▼
scanner-process.ts → Python scanner
  → settings.daq.num_frames used for frame count
  → settings.daq.seconds_per_rot used for rotation timing
       │
       ▼
scan-metadata-json.ts: buildMetadataObject()
  → reads settings.num_frames, settings.daq.seconds_per_rot
  → writes to metadata.json (snapshotted at scan time)
       │
       ▼
scanner-process.ts: saveScanToDatabase()
  → reads settings.daq.seconds_per_rot, scanResult.frames_captured
  → writes to Prisma Scan record
```

Config values are read when CaptureScan mounts. Changes to Machine Config take effect on next page load or app restart. In-progress scans are not affected.

## Risks / Trade-offs

- **Risk**: Python `CameraSettings(**kwargs)` will raise `TypeError` if caller passes `width`, `height`, `brightness`, or `contrast` in the JSON dict.
  - Mitigation: The IPC handler in `ipc_handler.py` constructs `CameraSettings` from the incoming dict. We filter unknown keys before constructing the dataclass.
- **Risk**: Prisma `Scan` model still has `brightness Float` and `contrast Float` as required columns.
  - Mitigation: `saveScanToDatabase()` supplies `brightness: 0` and `contrast: 0` (Basler identity values) regardless of `CameraSettings`.

## Open Questions

None — all decisions confirmed with the project owner.
