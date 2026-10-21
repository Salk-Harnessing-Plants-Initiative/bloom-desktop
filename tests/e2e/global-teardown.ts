/**
 * Playwright global teardown: remove the run's temp folder (see
 * helpers/pyinstaller-temp.ts).
 */

import * as fs from 'fs';
import { RUN_TEMP_ENV } from './helpers/pyinstaller-temp';

export default function globalTeardown(): void {
  const runTemp = process.env[RUN_TEMP_ENV];
  if (runTemp) fs.rmSync(runTemp, { recursive: true, force: true });
}
