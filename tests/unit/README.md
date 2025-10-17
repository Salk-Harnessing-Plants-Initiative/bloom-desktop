# TypeScript Unit Tests

This directory contains unit tests for TypeScript code (main process and utilities).

## Structure

```
unit/
├── main/
│   ├── python-process.test.ts    # PythonProcess class tests
│   ├── python-paths.test.ts      # Path resolution tests
│   ├── camera-process.test.ts    # Camera subprocess tests (future)
│   └── daq-process.test.ts       # DAQ subprocess tests (future)
└── components/
    └── CameraControl.test.tsx    # React component tests (future)
```

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npm run test:unit -- python-process.test.ts

# Run with coverage
npm run test:unit -- --coverage
```

## Test Framework

We use Jest for TypeScript testing:

- **Jest**: Test runner and assertion library
- **@testing-library/react**: React component testing (for renderer tests)
- **Mock subprocess**: Use Jest mocks for `child_process.spawn`

## Example Test

```typescript
import { PythonProcess } from '../../src/main/python-process';

describe('PythonProcess', () => {
  it('should start subprocess successfully', async () => {
    const pythonProcess = new PythonProcess('/path/to/python', ['--ipc']);
    await pythonProcess.start();
    expect(pythonProcess.isRunning()).toBe(true);
  });

  it('should send commands and receive responses', async () => {
    const pythonProcess = new PythonProcess('/path/to/python', ['--ipc']);
    await pythonProcess.start();

    const response = await pythonProcess.sendCommand({ command: 'ping' });
    expect(response).toEqual({ status: 'ok', message: 'pong' });
  });
});
```

## Integration Tests

End-to-end integration tests that spawn real Python processes belong in `tests/integration/`.
