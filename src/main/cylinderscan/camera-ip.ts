/**
 * Configured camera IP overlay (CylinderScan)
 *
 * Machine Configuration (`CAMERA_IP_ADDRESS` in ~/.bloom/.env) is the only
 * place the camera IP is set (#338). The renderer never sends a real IP, so
 * the main process applies the configured one to every set of camera
 * settings it forwards to Python (#390).
 *
 * Pure and Electron-free so it can be unit-tested without main.ts.
 */

import type { CameraSettings } from '../../types/camera';
import type { ScannerSettings } from '../../types/scanner';

/** Minimal shape of the machine config this module reads. */
export interface CameraIpConfigLike {
  camera_ip_address?: string;
}

/**
 * Read the configured camera IP.
 *
 * Returns `null` when no IP is configured or the config can't be read, in
 * which case callers forward settings unchanged rather than failing the
 * camera call.
 */
export function readConfiguredCameraIp(
  loadConfig: () => CameraIpConfigLike
): string | null {
  try {
    const ip = loadConfig().camera_ip_address?.trim();
    return ip ? ip : null;
  } catch (error) {
    console.warn(
      '[CameraIP] Failed to read configured camera IP; forwarding settings unchanged:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return null;
  }
}

/**
 * Return a copy of `settings` with `camera_ip_address` set to `ip`.
 *
 * `undefined` settings are passed through so calls that rely on Python's
 * existing camera instance aren't turned into incomplete settings objects.
 */
export function applyCameraIp<T extends Partial<CameraSettings>>(
  settings: T,
  ip: string | null
): T;
export function applyCameraIp<T extends Partial<CameraSettings>>(
  settings: T | undefined,
  ip: string | null
): T | undefined;
export function applyCameraIp<T extends Partial<CameraSettings>>(
  settings: T | undefined,
  ip: string | null
): T | undefined {
  if (!settings || ip === null) {
    return settings;
  }
  return { ...settings, camera_ip_address: ip };
}

/** Apply the configured IP to `ScannerSettings.camera`. */
export function applyScannerCameraIp(
  settings: ScannerSettings,
  ip: string | null
): ScannerSettings {
  if (ip === null) {
    return settings;
  }
  return { ...settings, camera: { ...settings.camera, camera_ip_address: ip } };
}
