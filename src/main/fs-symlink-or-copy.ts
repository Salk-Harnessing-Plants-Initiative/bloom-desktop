/**
 * Ensures a symlink exists at linkPath pointing to target, falling back to
 * a recursive copy if symlink creation fails.
 *
 * Windows restricts unprivileged symlink creation (requires admin or
 * Developer Mode) — the default state for most accounts, including
 * GitHub Actions runners and most lab machines. Code that needs a
 * dependency resolvable at a specific path (e.g. Node's module resolution
 * for a Prisma client staged outside an asar archive) must not assume
 * symlinkSync succeeds; a real file/directory copy is functionally
 * equivalent for that purpose.
 */

import fs from 'fs';

export function ensureSymlinkOrCopy(
  target: string,
  linkPath: string,
  type: 'dir' | 'file' = 'dir'
): void {
  if (fs.existsSync(linkPath)) {
    return;
  }

  try {
    fs.symlinkSync(target, linkPath, type);
    console.log(
      '[fs-symlink-or-copy] Created symlink:',
      linkPath,
      '->',
      target
    );
    return;
  } catch (symlinkError) {
    console.error(
      '[fs-symlink-or-copy] Symlink creation failed, falling back to copy:',
      symlinkError
    );
  }

  try {
    fs.cpSync(target, linkPath, { recursive: true });
    console.log('[fs-symlink-or-copy] Copied:', target, '->', linkPath);
  } catch (copyError) {
    console.error('[fs-symlink-or-copy] Fallback copy also failed:', copyError);
    throw copyError;
  }
}
