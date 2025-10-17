# Hardware Interface Modules

This directory contains Python modules for controlling hardware devices used in the Bloom Desktop application.

## Structure (Phase 3)

```
hardware/
├── __init__.py
├── camera.py              # Basler camera interface (PyPylon)
├── camera_mock.py         # Mock camera for testing
├── camera_types.py        # Camera type definitions
├── daq.py                 # NI-DAQ interface (nidaqmx)
├── daq_mock.py            # Mock DAQ for testing
├── daq_types.py           # DAQ type definitions
└── rotation.py            # Rotation control logic for 360° scans
```

## Modules

### Camera Interface (`camera.py`)

Controls Basler GigE cameras via PyPylon:

- Connect to camera by IP address
- Configure camera settings (exposure, gain, brightness, etc.)
- Capture single images
- Stream continuous frames
- Return images as base64-encoded PNG

**Migrated from pilot**: `pylon/pylon.py`, `pylon/pylon_stream.py`

### Camera Mock (`camera_mock.py`)

Mock camera implementation for testing without hardware:

- Same API as real camera
- Generates test pattern images
- No PyPylon dependency required

**Migrated from pilot**: `pylon/pylon_fake.py`, `pylon/pylon_stream_fake.py`

### DAQ Interface (`daq.py`)

Controls National Instruments DAQ for rotation:

- Initialize NI-DAQ device
- Control stepper motor for rotation stage
- Rotate by degrees or steps
- Synchronize with camera triggers

**Migrated from pilot**: `daq/` directory

### DAQ Mock (`daq_mock.py`)

Mock DAQ implementation for testing without hardware:

- Same API as real DAQ
- Simulates rotation timing
- No NI-DAQmx dependency required

## Usage Example

### Camera

```python
from python.hardware.camera import Camera

# Connect to camera
camera = Camera(ip_address="10.0.0.45")
if camera.connect():
    # Configure settings
    camera.set_exposure(10000)  # 10ms
    camera.set_gain(5.0)         # 5dB

    # Capture image
    image_base64 = camera.capture()
    print(f"Captured image: {len(image_base64)} bytes")

    camera.disconnect()
```

### DAQ

```python
from python.hardware.daq import DAQ

# Connect to DAQ
daq = DAQ(device_id="Dev1")
if daq.connect():
    # Rotate 90 degrees clockwise
    daq.rotate(90)

    # Get current position
    position = daq.get_position()
    print(f"Current position: {position}°")

    # Return to home
    daq.home()

    daq.disconnect()
```

## Mock Hardware for Testing

Use mock implementations when physical hardware is not available:

```python
import os

# Set environment variable to use mock hardware
os.environ['BLOOM_USE_MOCK_HARDWARE'] = 'true'

from python.hardware.camera_mock import CameraMock as Camera
from python.hardware.daq_mock import DAQMock as DAQ

# Rest of the code is identical to real hardware
camera = Camera(ip_address="mock")
camera.connect()
# ...
```

## IPC Integration

Hardware modules are called from `python/ipc_handler.py`:

```python
# In ipc_handler.py
def handle_command(cmd: Dict[str, Any]) -> None:
    command = cmd.get("command")

    if command == "camera:connect":
        ip = cmd.get("ip_address")
        camera = Camera(ip_address=ip)
        success = camera.connect()
        send_data({"connected": success})

    elif command == "camera:capture":
        image = camera.capture()
        print(f"IMAGE:{image}", flush=True)  # Send via stdout protocol
```

## Testing

Tests for hardware modules are in `python/tests/hardware/`:

- `test_camera.py` - Camera interface tests (uses mock)
- `test_daq.py` - DAQ interface tests (uses mock)

Run hardware tests:

```bash
# Run all tests (uses mocks)
npm run test:python

# Test with real hardware (optional)
BLOOM_USE_REAL_CAMERA=true BLOOM_CAMERA_IP=10.0.0.45 npm run test:python
```

## Development Guidelines

### Adding New Hardware Modules

1. Create main module: `hardware/device.py`
2. Create mock module: `hardware/device_mock.py`
3. Create types: `hardware/device_types.py`
4. Add tests: `tests/hardware/test_device.py`
5. Update IPC handler: `ipc_handler.py`
6. Update TypeScript types: `src/types/device.ts`
7. Create subprocess wrapper: `src/main/device-process.ts`

### Mock Implementation Requirements

Mock implementations must:

- Match the exact API of real hardware
- Use same function signatures
- Return same data types
- Simulate realistic timing/behavior
- Not require hardware dependencies

## Related Issues

- Issue #15: Camera Interface Migration
- Issue #16: DAQ Interface Migration
- Issue #12: Python IPC Protocol (foundation)
