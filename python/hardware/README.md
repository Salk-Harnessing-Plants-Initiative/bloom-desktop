# Hardware Interface Modules

Python modules that control the CylinderScan hardware: a Basler camera (through
`pypylon`) and a stepper-motor turntable driven by an NI DAQ (through `nidaqmx`).
Bloom Desktop runs them, and they can also be used on their own.

## Files

```
hardware/
├── __init__.py
├── camera.py          # Basler camera (pypylon): open, grab, software-triggered capture
├── camera_mock.py     # MockCamera: same API, no camera needed
├── camera_types.py    # CameraSettings
├── daq.py             # NI-DAQ turntable control (nidaqmx): step and direction pulses
├── daq_mock.py        # MockDAQ: same API, no DAQ needed
├── daq_types.py       # DAQSettings, steps per turntable turn
├── scanner.py         # Scanner: runs a full scan (turntable + camera together)
├── scanner_types.py   # ScannerSettings, ScanResult
└── scan_preview.py    # Small preview picture of each frame, for the app
```

## How the hardware is driven

- **Camera:** a Basler GigE camera (ours is an acA2000-50gm), found by its IP
  address. Exposure, gain (`GainRaw`, an integer) and gamma are set from
  `CameraSettings`. During a scan, each frame is taken on a software trigger.
- **Turntable:** the NI DAQ sends step and direction pulses on two digital lines
  to a step/direction motor driver (ours is an Applied Motion STR3 driving an
  HW23-753 stepper). Defaults in `DAQSettings`:
  - device `cDAQ1Mod1` (an NI-9401 module in a cDAQ-9171 chassis)
  - step on line 0, direction on line 1
  - `steps_per_revolution` = 28,571: the driver set to 20,000 microsteps per
    motor turn, times 42:60 gearing to the turntable. Change it to match your
    driver setting and gears.
- **A scan:** the turntable turns continuously, one turn in `seconds_per_rot`
  seconds (default 7), and the camera is triggered at each of `num_frames`
  positions (default 72, 5° apart). Frames are saved as `001.png`, `002.png`, …
  If any frame doesn't arrive, nothing is saved, because the others' angles
  can't be known.

## Usage

Run from the repository root, with NI-DAQmx and Basler pylon installed.

### Full scan

```python
import os

os.environ["BLOOM_USE_MOCK_HARDWARE"] = "false"  # use the real camera and DAQ

from python.hardware.camera_types import CameraSettings
from python.hardware.daq_types import DAQSettings
from python.hardware.scanner import Scanner
from python.hardware.scanner_types import ScannerSettings

settings = ScannerSettings(
    camera=CameraSettings(exposure_time=10000, gain=100, camera_ip_address="10.0.0.23"),
    daq=DAQSettings(device_name="cDAQ1Mod1"),
    num_frames=72,
    output_path="./scans/plant_001",
)

scanner = Scanner(settings)
scanner.initialize()
try:
    result = scanner.perform_scan()  # call from the main thread
    print(result.success, result.frames_captured, result.output_path)
finally:
    scanner.cleanup()
```

`Scanner` uses the mock camera and DAQ unless `BLOOM_USE_MOCK_HARDWARE` is set
to `false`.

### Camera only

```python
from python.hardware.camera import Camera
from python.hardware.camera_types import CameraSettings

camera = Camera(CameraSettings(exposure_time=10000, gain=100, camera_ip_address="10.0.0.23"))
camera.open()
try:
    image = camera.grab_frame()  # numpy array
    print(image.shape)
finally:
    camera.close()
```

For a triggered sequence: `start_triggered_capture(n)`, then for each frame
`trigger_frame()` and `retrieve_next_frame()`, then `stop_triggered_capture()`.

### Turntable only

```python
from python.hardware.daq import DAQ
from python.hardware.daq_types import DAQSettings

daq = DAQ(DAQSettings(device_name="cDAQ1Mod1", step_pin=0, dir_pin=1))
daq.initialize()
try:
    daq.rotate(90)              # degrees; negative turns the other way
    print(daq.get_position())   # current angle, 0-360
    daq.home()                  # back to 0°
finally:
    daq.cleanup()
```

## Without hardware

`MockCamera` and `MockDAQ` have the same methods as `Camera` and `DAQ`, and need
neither pypylon nor nidaqmx. `MockCamera` returns test images.

```python
from python.hardware.camera_mock import MockCamera
from python.hardware.daq_mock import MockDAQ
```

`Scanner` uses them automatically while `BLOOM_USE_MOCK_HARDWARE` is `true` (the
default). In Bloom Desktop, `BLOOM_USE_MOCK_HARDWARE`, `BLOOM_USE_MOCK_CAMERA` and
`BLOOM_USE_MOCK_DAQ` choose real or mock hardware.

## How Bloom Desktop calls these modules

The app starts `python/main.py --ipc` and sends it JSON commands (`camera`, `daq`,
`scanner`, `check_hardware`) over stdin; `python/ipc_handler.py` routes them to
these modules and sends results back on stdout.

## Tests

Tests are in `python/tests/` (for example `test_scanner.py`, `test_daq_rotation.py`,
`test_camera_commands.py`) and use the mocks:

```bash
npm run test:python
```
