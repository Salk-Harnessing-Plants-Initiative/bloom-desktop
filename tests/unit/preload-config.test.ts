// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron module
const mockInvoke = vi.fn().mockResolvedValue({});
let exposedAPI: any = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: any) => {
      exposedAPI = api;
    }),
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

describe('preload config namespace', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    exposedAPI = null;
    vi.resetModules();
    await import('../../src/main/preload');
  });

  it('exposes config namespace on electron API', () => {
    expect(exposedAPI).toBeTruthy();
    expect(exposedAPI.config).toBeTruthy();
  });

  it('getGraviScanEnvStatus calls ipcRenderer.invoke with correct channel', async () => {
    await exposedAPI.config.getGraviScanEnvStatus();
    expect(mockInvoke).toHaveBeenCalledWith('config:get-graviscan-env-status');
  });
});
