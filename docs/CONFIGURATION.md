# Bloom Desktop Configuration

This document describes all configurable constants and default values in the Bloom Desktop application. These settings control scanner hardware behavior, camera settings, and data acquisition parameters.

**For Admin UI Implementation**: When building the admin settings UI, reference this document for all configuration options that should be made user-configurable.

## Scanner Settings

### Rotation & Timing

| Constant          | Type     | Default     | Description                                                                                                                        | Location                                                 | Admin Configurable                 |
| ----------------- | -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- |
| `seconds_per_rot` | `number` | `7.0`       | Time for one complete 360° rotation in seconds. Controls rotation speed and frame timing.                                          | [src/types/daq.ts:61](../src/types/daq.ts#L61)           | ✅ Yes - Critical for scan quality |
| `num_frames`      | `number` | `72`        | Number of frames to capture during a complete rotation. Each frame captures plant from different angle (360° / 72 = 5° per frame). | [src/types/daq.ts:60](../src/types/daq.ts#L60)           | ✅ Yes - Affects scan resolution   |
| `output_path`     | `string` | `'./scans'` | Default directory for storing scan images.                                                                                         | [src/types/scanner.ts:217](../src/types/scanner.ts#L217) | ✅ Yes - For data management       |

**Relationship Between Settings**:

- **Frame interval** = `seconds_per_rot / num_frames` (e.g., 7s / 72 frames = ~0.097s per frame)
- **Degrees per frame** = 360° / num_frames (e.g., 360° / 72 = 5° per frame)
- **Total scan time** ≈ `seconds_per_rot` seconds

**Performance Considerations**:

- **Faster rotation** (lower `seconds_per_rot`): Shorter scans, but potential motion blur
- **Slower rotation** (higher `seconds_per_rot`): Sharper images, but longer scan times
- **More frames** (higher `num_frames`): Higher angular resolution, but more data storage

## DAQ (Data Acquisition) Settings

### Hardware Configuration

| Constant               | Type     | Default       | Description                                                                  | Location                                       | Admin Configurable                        |
| ---------------------- | -------- | ------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `device_name`          | `string` | `'cDAQ1Mod1'` | NI-DAQ device identifier for turntable control                               | [src/types/daq.ts:55](../src/types/daq.ts#L55) | ⚠️ Maybe - Hardware-specific              |
| `sampling_rate`        | `number` | `40000`       | DAQ sampling rate in Hz for step signal generation                           | [src/types/daq.ts:56](../src/types/daq.ts#L56) | ❌ No - Hardware-specific                 |
| `step_pin`             | `number` | `0`           | Digital output line for stepper motor step signal                            | [src/types/daq.ts:57](../src/types/daq.ts#L57) | ❌ No - Hardware-specific                 |
| `dir_pin`              | `number` | `1`           | Digital output line for stepper motor direction signal                       | [src/types/daq.ts:58](../src/types/daq.ts#L58) | ❌ No - Hardware-specific                 |
| `steps_per_revolution` | `number` | `6400`        | Number of stepper motor steps for full 360° rotation (microstepping setting) | [src/types/daq.ts:59](../src/types/daq.ts#L59) | ⚠️ Maybe - Depends on motor configuration |

## Camera Settings

### Image Capture Parameters

| Constant            | Type     | Default  | Description                                           | Location                                               | Admin Configurable                      |
| ------------------- | -------- | -------- | ----------------------------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| `exposure_time`     | `number` | `10000`  | Camera exposure time in microseconds (10ms = 10000µs) | [src/types/camera.ts:119](../src/types/camera.ts#L119) | ✅ Yes - Affects image brightness       |
| `gain`              | `number` | `0`      | Camera sensor gain value (0 = no amplification)       | [src/types/camera.ts:120](../src/types/camera.ts#L120) | ✅ Yes - Affects image brightness/noise |
| `camera_ip_address` | `string` | `'mock'` | IP address for network camera, or 'mock' for testing  | [src/types/camera.ts:121](../src/types/camera.ts#L121) | ⚠️ Maybe - Hardware-specific            |
| `gamma`             | `number` | `1.0`    | Gamma correction value (1.0 = no correction)          | [src/types/camera.ts:122](../src/types/camera.ts#L122) | ✅ Yes - Image processing               |
| `brightness`        | `number` | `0.5`    | Brightness adjustment (0.0-1.0 range)                 | [src/types/camera.ts:123](../src/types/camera.ts#L123) | ✅ Yes - Image processing               |

**Camera Configuration Tips**:

- **Exposure Time**: Increase for darker environments, decrease to reduce motion blur
- **Gain**: Use only when lighting is insufficient (adds noise)
- **Gamma**: Adjust for non-linear brightness correction (typically 1.0-2.2)

## File Locations

All default settings are defined in TypeScript type definition files:

- **DAQ Settings**: [src/types/daq.ts](../src/types/daq.ts) - `DEFAULT_DAQ_SETTINGS`
- **Camera Settings**: [src/types/camera.ts](../src/types/camera.ts) - `DEFAULT_CAMERA_SETTINGS`
- **Scanner Settings**: [src/types/scanner.ts](../src/types/scanner.ts) - `DEFAULT_SCANNER_SETTINGS`

## Configuration Priority for Admin UI

When implementing the admin configuration UI, prioritize settings in this order:

### Phase 1: Critical Scan Parameters

1. `seconds_per_rot` - Most frequently adjusted for scan speed/quality tradeoff
2. `num_frames` - Affects scan resolution and data volume
3. `exposure_time` - Essential for image quality
4. `gain` - Important for lighting conditions

### Phase 2: Image Quality

1. `gamma` - Fine-tuning image appearance
2. `brightness` - Basic image adjustment
3. `output_path` - Data management

### Phase 3: Advanced/Hardware (Optional)

1. `device_name` - For multiple scanner setups
2. `camera_ip_address` - For camera network configuration
3. `steps_per_revolution` - For custom stepper motor configurations

## Implementation Notes for Admin UI

### Storage Strategy

Configuration values should be stored in:

1. **Database**: For per-scan overrides (already stored in `Scan` table)
2. **Application Settings**: For global defaults (future: user preferences table)
3. **Type Definitions**: For fallback defaults (current implementation)

### Validation Rules

**seconds_per_rot**:

- Type: `number`
- Range: `> 0` (must be positive)
- Recommended: `5.0 - 60.0` seconds
- Validation: See [python/hardware/daq_types.py:47](../python/hardware/daq_types.py#L47)

**num_frames**:

- Type: `number`
- Range: `> 0` (must be positive)
- Common values: `36, 72, 144, 288` (divisors of 360 for even degree increments)

**exposure_time**:

- Type: `number`
- Range: `> 0` (must be positive, in microseconds)
- Recommended: `1000 - 50000` µs (1ms - 50ms)

**gain**:

- Type: `number`
- Range: Camera-dependent (Basler typically `0 - 24` dB)
- Validation: See [python/hardware/camera_types.py:55](../python/hardware/camera_types.py#L55)

## Database Schema

Scan configuration values are persisted in the database:

```prisma
model Scan {
  // ... other fields

  // Scanner settings
  num_frames      Int
  seconds_per_rot Float

  // Camera settings
  exposure_time   Int
  gain            Float
  gamma           Float

  // ... other fields
}
```

See [prisma/schema.prisma](../prisma/schema.prisma) for complete schema.

## Version History

| Date       | Change                                         | Reason                                            |
| ---------- | ---------------------------------------------- | ------------------------------------------------- |
| 2025-10-29 | Changed `seconds_per_rot` from `36.0` to `7.0` | Faster default scan speed for development/testing |
| 2025-10-28 | Initial database integration                   | Enable persistent scan configuration              |
| 2024-XX-XX | Initial implementation                         | Match pilot compatibility                         |

## Related Documentation

- [SCANNER_TESTING.md](SCANNER_TESTING.md) - Scanner hardware testing procedures
- [DAQ_TESTING.md](DAQ_TESTING.md) - DAQ hardware testing procedures
- [DATABASE.md](DATABASE.md) - Database schema documentation
- [PILOT_COMPATIBILITY.md](PILOT_COMPATIBILITY.md) - Compatibility with pilot implementation
