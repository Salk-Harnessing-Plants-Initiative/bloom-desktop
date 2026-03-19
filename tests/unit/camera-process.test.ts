/**
 * CameraProcess unit tests
 *
 * Tests detectCameras response handling for various response formats.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  }),
}));

import { CameraProcess } from '../../src/main/camera-process';

describe('CameraProcess.detectCameras', () => {
  let camera: CameraProcess;

  beforeEach(() => {
    camera = new CameraProcess('/fake/python', ['--ipc']);
  });

  it('4.1 returns array when response is array', async () => {
    const mockCameras = [
      { ip_address: '192.168.1.100', model_name: 'acA2000-50gm', serial_number: '123', mac_address: 'aa:bb', user_defined_name: 'test', friendly_name: 'Test Cam', is_mock: false },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue(mockCameras);

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.2 returns cameras when response has cameras field', async () => {
    const mockCameras = [
      { ip_address: '192.168.1.100', model_name: 'acA2000-50gm', serial_number: '123', mac_address: 'aa:bb', user_defined_name: 'test', friendly_name: 'Test Cam', is_mock: false },
    ];
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({ cameras: mockCameras, count: 1 });

    const result = await camera.detectCameras();
    expect(result).toEqual(mockCameras);
  });

  it('4.3 returns empty array for non-camera success response', async () => {
    // This happens when response routing delivers a configure response to detectCameras
    vi.spyOn(camera, 'sendCommand').mockResolvedValue({ success: true, configured: true });

    const result = await camera.detectCameras();
    expect(result).toEqual([]);
  });
});
