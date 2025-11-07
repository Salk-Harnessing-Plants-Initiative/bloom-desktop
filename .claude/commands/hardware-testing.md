# Hardware Integration Testing

Guide for testing camera, DAQ, and scanner hardware integration with both mock and real hardware.

## Mock Hardware Testing (CI)

All CI tests use mock hardware - no real devices required.

### Camera Testing

```bash
# Run camera integration test with mock camera
npm run test:camera

# What it tests:
# - Camera connection and initialization
# - Frame streaming and capture
# - Camera settings (exposure, gain, brightness)
# - Graceful disconnect handling
```

### DAQ Testing

```bash
# Run DAQ integration test with mock DAQ
npm run test:daq

# What it tests:
# - DAQ device connection
# - Analog output control (turntable rotation)
# - Configuration validation
# - Error handling (device not found)
```

### Scanner Testing

```bash
# Run full scanner workflow with mock hardware
npm run test:scanner

# What it tests:
# - Complete cylinder scanning workflow
# - Rotation + frame capture coordination
# - Timing and synchronization
# - Metadata capture

# Run scanner with database integration
npm run test:scanner-database

# What it tests:
# - Scan metadata persistence
# - Image storage
# - Database integrity
```

## Real Hardware Testing (Local)

Test with actual Basler cameras and NI-DAQ devices.

### Prerequisites

#### Camera (Basler Pylon)

1. **Install Basler Pylon SDK**: [Download from Basler](https://www.baslerweb.com/en/products/software/basler-pylon-camera-software-suite/)
2. **Connect camera**: USB 3.0 or GigE connection
3. **Verify installation**:

   ```bash
   # macOS/Linux
   which pylon  # Should show path to Pylon installation

   # Test camera enumeration
   python -c "from pypylon import pylon; print(pylon.TlFactory.GetInstance().EnumerateDevices())"
   ```

#### DAQ (NI-DAQmx)

1. **Install NI-DAQmx Runtime**: [Download from NI](https://www.ni.com/en-us/support/downloads/drivers/download.ni-daqmx.html)
2. **Connect DAQ device**: USB connection
3. **Verify installation**:

   ```bash
   # Check NI-DAQmx version
   python -c "import nidaqmx; print(nidaqmx.system.System().driver_version)"

   # List devices
   python -c "import nidaqmx; print(nidaqmx.system.System().devices)"
   ```

### Running with Real Hardware

#### Camera

```bash
# Set environment variable to use real camera
export BLOOM_USE_REAL_CAMERA=true

# Run camera test
npm run test:camera

# Or run integration tests
npm run test:ipc
npm run test:scanner
```

#### DAQ

```bash
# Set environment variable to use real DAQ
export BLOOM_USE_REAL_DAQ=true

# Run DAQ test
npm run test:daq
```

#### Full Scanner Workflow

```bash
# Use real hardware for complete workflow
export BLOOM_USE_REAL_CAMERA=true
export BLOOM_USE_REAL_DAQ=true

npm run test:scanner
npm run test:scanner-database
```

### Manual Testing

For interactive hardware testing:

```bash
# Build and run the app
npm run build:python
npm run start

# In the app:
# 1. Navigate to camera settings
# 2. Adjust exposure, gain, brightness
# 3. Start live preview
# 4. Verify frame rate and image quality

# For scanner:
# 1. Set up turntable and camera
# 2. Enter scan metadata
# 3. Run cylinder scan
# 4. Verify rotation speed and frame capture
```

## Troubleshooting

### Camera Issues

#### "No camera devices found"

**Causes:**

- Camera not connected
- Pylon SDK not installed
- Camera drivers not loaded

**Solutions:**

1. Check USB/GigE connection
2. Verify Pylon SDK installation
3. Test with Pylon Viewer application
4. Check camera power and LED status

#### "Permission denied" on Linux

**Cause:** USB permissions

**Solution:**

```bash
# Add udev rule for Basler cameras
sudo sh -c 'echo "SUBSYSTEM==\"usb\", ATTR{idVendor}==\"2676\", MODE=\"0666\"" > /etc/udev/rules.d/99-basler.rules'
sudo udevadm control --reload-rules
```

#### "Failed to grab image" during streaming

**Causes:**

- USB bandwidth insufficient
- Camera buffer overrun
- Exposure time too long

**Solutions:**

1. Use USB 3.0 port (not USB 2.0 hub)
2. Reduce frame rate or resolution
3. Adjust exposure time
4. Check camera temperature (may throttle if overheating)

### DAQ Issues

#### "Device not found"

**Causes:**

- DAQ not connected
- NI-DAQmx not installed
- Device not configured in NI MAX

**Solutions:**

1. Check USB connection
2. Install NI-DAQmx Runtime
3. Open NI MAX (Measurement & Automation Explorer) and verify device appears
4. Run device self-test in NI MAX

#### "Resource in use"

**Cause:** Another application using DAQ device

**Solution:**

- Close NI MAX or other applications using DAQ
- Restart DAQ device
- Check for zombie processes: `ps aux | grep python`

#### "Analog output failed"

**Causes:**

- Invalid voltage range
- Channel not configured correctly
- Wiring issue

**Solutions:**

1. Verify voltage within device specs (typically ±10V)
2. Check physical wiring to turntable motor
3. Test with known-good configuration in NI MAX

### Integration Issues

#### Tests pass with mock hardware, fail with real hardware

**Common causes:**

1. **Timing issues**: Real hardware slower than mocks
   - Solution: Increase timeouts in tests
2. **Hardware initialization**: Real devices need warm-up time
   - Solution: Add delays after connection
3. **Resource cleanup**: Real devices need proper shutdown
   - Solution: Ensure cleanup in test teardown

#### "Python subprocess crashed" during hardware test

**Causes:**

- Hardware driver exception
- Memory issue
- SDK bug

**Solutions:**

1. Check Python subprocess logs in terminal
2. Run Python hardware script directly to isolate issue:
   ```bash
   echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc
   ```
3. Update SDK to latest version
4. Report to hardware vendor if SDK bug

## CI Behavior

CI always uses mock hardware:

- **Environment**: `BLOOM_USE_MOCK_CAMERA=true` (default)
- **Why**: CI runners don't have physical devices
- **Coverage**: Mock hardware provides sufficient integration test coverage
- **Real hardware**: Tested manually before releases

## Mock Hardware Implementation

Mock implementations simulate real hardware behavior:

- **`python/hardware/camera_mock.py`**: Generates test frames with patterns
- **`python/hardware/daq_mock.py`**: Simulates analog output and turntable control
- **Purpose**: Allow integration testing without physical devices

### When to Update Mocks

Update mocks when:

1. Adding new hardware features (e.g., camera brightness control)
2. Changing hardware interface (e.g., new IPC commands)
3. Fixing bugs in real hardware driver (reproduce in mock for test)

## Related Commands

- `/integration-testing` - Overview of all integration test types
- `/python-bundling` - Troubleshooting Python hardware driver builds
- `/e2e-testing` - Full application testing workflows

## Documentation

- **Camera testing**: `docs/CAMERA_TESTING.md`
- **DAQ testing**: `docs/DAQ_TESTING.md`
- **Scanner testing**: `docs/SCANNER_TESTING.md`
- **PyInstaller**: `python/PYINSTALLER.md`
