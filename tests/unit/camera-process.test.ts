/**
 * CameraProcess unit tests
 *
 * Tests detectCameras response handling for various response formats.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  })),
}));

import { CameraProcess } from '../../src/main/cylinderscan/camera-process';

describe('CameraProcess.detectCameras', () => {
  let camera: CameraProcess;

  beforeEach(() => {
    camera = new CameraProcess('/fake/python', ['--ipc']);
  });

  it('4.1 returns array when response is array', async () => {
    const mockCameras = [
      {
        ip_address: '192.168.1.100',
        model_name: 'acA2000-50gm',
        serial_number: '123',
        mac_address: 'aa:bb',
        user_defined_name: 'test',
        friendly_name: 'Test Cam',
        is_mock: false,
      },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue(mockCameras);

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.2 returns cameras when response has cameras field', async () => {
    const mockCameras = [
      {
        ip_address: '192.168.1.100',
        model_name: 'acA2000-50gm',
        serial_number: '123',
        mac_address: 'aa:bb',
        user_defined_name: 'test',
        friendly_name: 'Test Cam',
        is_mock: false,
      },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({
      cameras: mockCameras,
      count: 1,
    });

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.3 returns empty array for non-camera success response', async () => {
    // This happens when response routing delivers a configure response to detectCameras
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({
      success: true,
      configured: true,
    });

    const result = await camera.detectCameras();
    expect(result).toEqual([]);
  });

  it('4.4 throws on error response from Python', async () => {
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({
      success: false,
      error: 'Camera not connected',
    });

    await expect(camera.detectCameras()).rejects.toThrow(
      'Failed to detect cameras: Camera not connected'
    );
  });
});

describe('CameraProcess unrecognized-line warning (#318)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let dataHandler: (data: Buffer) => void;

  beforeEach(async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Clear prior calls so `.mock.results.at(-1)` below always refers to
    // THIS test's spawn() call, regardless of how many other tests in this
    // file call .start() before or after it (a fixed index like
    // `.mock.results[0]` would silently break if a test calling .start()
    // were ever added earlier in the file).
    vi.mocked(spawn).mockClear();

    const camera = new CameraProcess('/fake/python', ['--ipc']);
    const startPromise = camera.start();
    camera.emit('status', 'IPC handler ready');
    await startPromise;

    const results = vi.mocked(spawn).mock.results;
    const mockProc = results[results.length - 1].value as {
      stdout: { on: ReturnType<typeof vi.fn> };
    };
    const handler = mockProc.stdout.on.mock.calls.find(
      ([event]) => event === 'data'
    )?.[1] as ((data: Buffer) => void) | undefined;
    expect(handler).toBeDefined();
    dataHandler = handler!;
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it.each([
    ['FRAME:', 'FRAME:data:image/jpeg;base64,abc123'],
    ['TRIGGER_CAMERA', 'TRIGGER_CAMERA'],
    ['IMAGE (space)', 'IMAGE data:image/png;base64,abc123'],
    ['IMAGE_PATH (space)', 'IMAGE_PATH /tmp/scan/001.png'],
  ])(
    'does not warn for a %s line — CameraProcess.parseLine() handles it before it ever reaches the base class raw/warning path',
    (_label, line) => {
      dataHandler(Buffer.from(`${line}\n`));

      expect(warnSpy).not.toHaveBeenCalled();
    }
  );
});
