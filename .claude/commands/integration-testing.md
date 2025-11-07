# Integration Testing

Guide for running and understanding integration tests that verify communication between TypeScript, Python, and hardware.

## Test Types

### IPC Communication Test

Tests TypeScript ↔ Python subprocess communication.

```bash
npm run test:ipc

# What it tests:
# - Python subprocess starts successfully
# - IPC protocol (JSON-lines) works
# - Commands and responses properly formatted
# - Error handling and timeouts
```

### Camera Integration Test

Tests camera interface with mock camera.

```bash
npm run test:camera
# Alias: npm run test:streaming

# What it tests:
# - Camera initialization
# - Frame streaming and capture
# - Frame rate performance (5-40 FPS)
# - Stream start/stop
# - Mock camera generates valid frames
```

### DAQ Integration Test

Tests DAQ interface with mock DAQ.

```bash
npm run test:daq

# What it tests:
# - DAQ device connection
# - Analog output configuration
# - Turntable rotation control
# - Mock DAQ simulates timing correctly
```

### Scanner Workflow Test

Tests complete scanning workflow with mock hardware.

```bash
npm run test:scanner

# What it tests:
# - Full cylinder scanning workflow
# - Camera + DAQ coordination
# - Rotation + frame capture sync
# - Timing and synchronization
# - Error handling (hardware failure scenarios)
```

### Scanner Database Integration Test

Tests scanner workflow with database persistence.

```bash
npm run test:scanner-database

# What it tests:
# - Scan metadata saved to database
# - Image storage and retrieval
# - Database integrity after scan
# - Foreign key relationships
```

### Packaged App Tests

Tests that packaged application works correctly.

```bash
# Build package first
npm run package

# Test database initialization
npm run test:package:database

# What it tests:
# - Packaged app launches
# - Database creates in correct location
# - Prisma migrations run automatically
# - App can connect to database
```

## Running All Integration Tests

```bash
# Run all integration tests sequentially
npm run test:ipc
npm run test:camera
npm run test:daq
npm run test:scanner
npm run test:scanner-database
```

## CI Behavior

Integration tests run in GitHub Actions (`.github/workflows/pr-checks.yml`):

- **Platforms**: Linux, macOS, Windows
- **Hardware**: All use mock hardware (no real devices in CI)
- **Python executable**: Downloaded from artifact (built once per platform)
- **Timeout**: Tests must complete within job time limits
- **Failure**: Any failing integration test blocks PR merge

## Understanding Test Output

### Successful Test Example

```
============================================================
Testing Camera Streaming
============================================================

[TEST] Starting camera process...
[STATUS] sys.path=[...]
[STATUS] Successfully imported from hardware.*
[STATUS] IPC handler ready
[PASS] Camera process started successfully

[TEST 1] Starting stream...
[STATUS] Using mock camera
[STATUS] Mock camera opened
[STATUS] Streaming worker started
[PASS] Stream started successfully

[TEST 2] Waiting for frames (3 seconds)...
[EVENT] First frame received!
[PROGRESS] Frame 30 at 10.4s - FPS: 2.9
[PASS] Received 59 frames in 11.9s (5.0 FPS)
[PASS] FPS within expected range (5-40)

============================================================
ALL TESTS PASSED
============================================================
```

### Failed Test Example

```
[TEST] Starting camera process...
[ERROR] Failed to import camera modules: No module named 'imageio'
[FAIL] Camera process failed to start

Test failed with exit code 1
```

## Debugging Integration Tests

### View Python Subprocess Logs

Tests capture Python subprocess output:

```typescript
// In test file
pythonProcess.stdout.on('data', (data) => {
  console.log(`[PYTHON] ${data}`);
});

pythonProcess.stderr.on('data', (data) => {
  console.error(`[PYTHON ERROR] ${data}`);
});
```

Run test and check output for `[PYTHON]` and `[PYTHON ERROR]` messages.

### Add Debug Logging

Add STATUS messages in Python code:

```python
# In python/ipc_handler.py
print(f"STATUS:About to import camera module", flush=True)
from hardware.camera import Camera
print(f"STATUS:Camera module imported successfully", flush=True)
```

### Test IPC Protocol Directly

```bash
# Build Python executable
npm run build:python

# Test IPC manually
echo '{"command":"check_hardware"}' | ./dist/bloom-hardware --ipc

# Expected response:
# {"success": true, "camera_available": true, "daq_available": false}
```

### Run Single Test Scenario

Most integration tests are single-file scripts. Run directly:

```bash
# Run specific test with node
npx ts-node tests/integration/test-camera.ts

# Or with tsx (faster)
npx tsx tests/integration/test-camera.ts
```

## Common Issues

### Test Times Out

**Cause**: Python subprocess not responding, infinite loop, or deadlock

**Debug**:

1. Check if Python process is running: `ps aux | grep bloom-hardware`
2. Add timeouts to IPC commands
3. Check for blocking operations in Python code

### "Camera module not available"

**Cause**: PyInstaller bundling issue - missing hidden imports or metadata

**Solution**: See `/python-bundling` command

### Tests Pass Locally, Fail in CI

**Common causes**:

1. **Platform differences**: Windows vs macOS vs Linux
   - Check file paths use `path.join()` or `Path()`
   - Check line endings (CRLF vs LF)
2. **Timing issues**: CI slower than local machine
   - Increase timeouts
   - Add retry logic
3. **Resource cleanup**: Previous test didn't clean up
   - Ensure subprocess killed in test teardown
   - Check for zombie processes

### Python Subprocess Crashes

**Cause**: Unhandled exception in Python code

**Debug**:

1. Check stderr output (test should capture it)
2. Run Python executable directly with test command
3. Add try/except blocks around hardware operations

## Test Structure

Integration tests typically follow this pattern:

```typescript
import { spawn } from 'child_process';

// 1. Start Python subprocess
const pythonProcess = spawn('./dist/bloom-hardware', ['--ipc']);

// 2. Wait for ready signal
await waitForReady(pythonProcess);

// 3. Send IPC command
pythonProcess.stdin.write(JSON.stringify({ command: 'start_stream' }) + '\n');

// 4. Wait for response
const response = await waitForResponse(pythonProcess);

// 5. Verify response
assert(response.success === true);

// 6. Cleanup
pythonProcess.kill();
```

## Mock Hardware

Integration tests use mock implementations:

- **Mock Camera** (`python/hardware/camera_mock.py`):
  - Generates test pattern images
  - Simulates frame rate (5-40 FPS)
  - No actual camera required
- **Mock DAQ** (`python/hardware/daq_mock.py`):
  - Simulates analog output
  - Simulates timing delays
  - No actual DAQ device required

Benefits:

- Tests run in CI without hardware
- Deterministic behavior (no hardware flakiness)
- Fast execution (no hardware initialization delays)

## When to Add Integration Tests

Add integration tests when:

1. **New IPC command**: Test command handling and response format
2. **New hardware feature**: Test with mock hardware
3. **New workflow**: Test end-to-end scenario
4. **Bug fix**: Regression test to prevent recurrence

## Test Coverage Goals

Integration tests should cover:

- ✅ All IPC command types
- ✅ All hardware interfaces (camera, DAQ, scanner)
- ✅ Error scenarios (device not found, command failed)
- ✅ Database integration (for scanner workflow)
- ✅ Subprocess lifecycle (start, crash recovery, cleanup)

## Related Commands

- `/hardware-testing` - Testing with real hardware
- `/python-bundling` - Building Python executable for tests
- `/e2e-testing` - Full application testing
- `/coverage` - Test coverage expectations

## Documentation

- **Camera Testing**: `docs/CAMERA_TESTING.md`
- **DAQ Testing**: `docs/DAQ_TESTING.md`
- **Scanner Testing**: `docs/SCANNER_TESTING.md`