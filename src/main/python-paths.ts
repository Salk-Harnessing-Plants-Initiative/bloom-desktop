/**
 * Python Path Resolution
 *
 * Utilities for resolving the path to the Python executable
 * in both development and production environments.
 */

import { app } from 'electron';
import path from 'path';
import fs from 'fs';

/**
 * Get the path to the Python executable.
 *
 * In development:
 *   - Returns path to dist/bloom-hardware (built by build-python.js)
 *
 * In production:
 *   - Returns path to bundled executable in app resources
 *
 * @returns Absolute path to Python executable
 */
export function getPythonExecutablePath(): string {
  const exeName =
    process.platform === 'win32' ? 'bloom-hardware.exe' : 'bloom-hardware';

  if (app.isPackaged) {
    // Production: bundled in resources
    return path.join(process.resourcesPath, exeName);
  } else {
    // Development: built by build-python.js in dist/
    const devPath = path.join(__dirname, '..', '..', 'dist', exeName);
    return devPath;
  }
}

/**
 * Check if the Python executable exists at the expected path.
 *
 * @returns true if executable exists, false otherwise
 */
export function pythonExecutableExists(): boolean {
  const pythonPath = getPythonExecutablePath();
  return fs.existsSync(pythonPath);
}

/**
 * Get the directory containing the Python executable.
 *
 * @returns Absolute path to directory
 */
export function getPythonExecutableDir(): string {
  const pythonPath = getPythonExecutablePath();
  return path.dirname(pythonPath);
}

/**
 * Validate that Python executable exists and throw helpful error if not.
 *
 * @throws Error with helpful message if executable not found
 */
export function validatePythonExecutable(): void {
  const pythonPath = getPythonExecutablePath();

  if (!fs.existsSync(pythonPath)) {
    if (app.isPackaged) {
      throw new Error(
        `Python executable not found in production bundle: ${pythonPath}\n` +
          'This is a packaging error. The Python executable should be bundled with the app.'
      );
    } else {
      throw new Error(
        `Python executable not found: ${pythonPath}\n` +
          'Run "npm run build:python" to build the Python executable.'
      );
    }
  }

  // Check if executable is actually executable (Unix only)
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(pythonPath, fs.constants.X_OK);
    } catch (error) {
      throw new Error(
        `Python executable found but not executable: ${pythonPath}\n` +
          `Run: chmod +x "${pythonPath}"`
      );
    }
  }
}
