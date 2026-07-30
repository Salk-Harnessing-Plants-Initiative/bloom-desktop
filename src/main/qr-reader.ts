/**
 * QR Code Reader
 *
 * Decodes QR/barcodes from scan images by shelling out to the bundled Python
 * executable's `--decode-qr-batch` mode (OpenCV `cv2.QRCodeDetector`), rather
 * than decoding in-process with a Node/WASM zbar binding. See
 * docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md for the
 * rationale (WASM asset was never copied into the webpack build, and the
 * binding is LGPL in an otherwise BSD-2-Clause app).
 *
 * The whole point of the one-shot-subprocess design is that a verification
 * batch costs ONE spawn, not one per image — callers should prefer
 * `readQrCodesBatch()` and only reach for `readQrCodes()` for genuinely
 * single-image cases.
 *
 * If the batch subprocess dies (native crash inside OpenCV's decoder on a
 * corrupt or hostile image), each image is retried in its own subprocess so
 * the failure is isolated to the offending image instead of blanking the
 * whole session's codes.
 *
 * Wire protocol (mirrored by `python/main.py::decode_qr_batch_mode`):
 *   stdin  <- JSON array of image paths (avoids Windows argv length limits)
 *   stdout -> JSON array of `{ path, codes }`, one entry per input path
 *   stderr -> diagnostics only
 *
 * Usage:
 *   const results = await readQrCodesBatch(['/path/a.tif', '/path/b.tif']);
 *   const codes = await readQrCodes('/path/to/scan.tif');
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { getPythonExecutablePath } from './python-paths';

/** One decode result, always present for every requested path. */
export type QrCodeResult = {
  path: string;
  codes: string[];
};

/**
 * Sequential queue — only one decode subprocess runs at a time. Decoding a
 * full-resolution TIFF is memory-hungry; concurrent batches from overlapping
 * callers would multiply that.
 */
let qrReadQueue: Promise<unknown> = Promise.resolve();

type SpawnOutcome =
  /** Subprocess exited 0 and produced parseable JSON. */
  | { kind: 'ok'; results: unknown[] }
  /**
   * Subprocess exited non-zero. This is the signature of a native crash
   * inside the OpenCV decoder (a corrupt or hostile image can take the whole
   * interpreter down), so it is distinguished from a plain protocol failure:
   * the caller retries the images individually to isolate the bad one.
   */
  | { kind: 'crashed' }
  /** Could not spawn, or exited 0 with unparseable output. Not retryable. */
  | { kind: 'failed' };

/**
 * Run one `--decode-qr-batch` subprocess. Never rejects.
 */
function runDecodeSubprocess(imagePaths: string[]): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let proc;
    try {
      // Inside the try: getPythonExecutablePath() reads electron's `app`, and
      // a throw here must become a clean 'failed' outcome rather than an
      // unexpected rejection out of this promise.
      const executable = getPythonExecutablePath();
      proc = spawn(executable, ['--decode-qr-batch'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // Force UTF-8 on the Python side of the pipe. Without this, Windows
        // Python decodes stdin (and encodes stdout) using the locale codepage
        // — a non-ASCII character anywhere in an image path would corrupt the
        // request or the response.
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
    } catch (error) {
      console.error(
        '[QR Reader] Failed to spawn QR decode subprocess:',
        error instanceof Error ? error.message : error
      );
      settle({ kind: 'failed' });
      return;
    }

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error: Error) => {
      console.error(
        '[QR Reader] QR decode subprocess error:',
        error instanceof Error ? error.message : error
      );
      settle({ kind: 'failed' });
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        console.error(
          `[QR Reader] QR decode subprocess exited with code ${code}` +
            (stderr.trim() ? `: ${stderr.trim()}` : '')
        );
        settle({ kind: 'crashed' });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          throw new Error(
            `expected a JSON array, got ${typeof parsed} from --decode-qr-batch`
          );
        }
        settle({ kind: 'ok', results: parsed });
      } catch (error) {
        console.error(
          '[QR Reader] Could not parse QR decode subprocess output:',
          error instanceof Error ? error.message : error
        );
        settle({ kind: 'failed' });
      }
    });

    try {
      // Node writes strings to a pipe as UTF-8 by default; the subprocess env
      // above makes Python read them the same way.
      proc.stdin?.write(JSON.stringify(imagePaths));
      proc.stdin?.end();
    } catch (error) {
      console.error(
        '[QR Reader] Failed to write image paths to subprocess stdin:',
        error instanceof Error ? error.message : error
      );
      settle({ kind: 'failed' });
    }
  });
}

/**
 * Project the subprocess response back onto the requested paths, so callers
 * always get exactly one entry per input, in input order. A path the
 * subprocess omitted (or reported malformed) yields empty codes.
 */
function alignResults(
  imagePaths: string[],
  rawResults: unknown[]
): QrCodeResult[] {
  const byPath = new Map<string, string[]>();

  for (const entry of rawResults) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { path?: unknown; codes?: unknown };
    if (typeof record.path !== 'string' || !Array.isArray(record.codes)) {
      continue;
    }
    byPath.set(
      record.path,
      record.codes.filter((code): code is string => typeof code === 'string')
    );
  }

  return imagePaths.map((imagePath) => {
    const codes: string[] = byPath.get(imagePath) ?? [];
    return { path: imagePath, codes };
  });
}

/**
 * Decode one batch, isolating a native decoder crash to the image that caused
 * it instead of blanking the whole batch.
 */
async function decodeBatch(imagePaths: string[]): Promise<QrCodeResult[]> {
  const outcome = await runDecodeSubprocess(imagePaths);

  if (outcome.kind === 'ok') {
    const aligned = alignResults(imagePaths, outcome.results);
    const total = aligned.reduce((sum, r) => sum + r.codes.length, 0);
    console.log(
      `[QR Reader] ${total} code(s) across ${aligned.length} image(s): ` +
        aligned
          .map((r) => `${path.basename(r.path)}=${r.codes.length}`)
          .join(', ')
    );
    return aligned;
  }

  // A non-zero exit kills every path in the batch at once. Left alone, a
  // single corrupt or hostile image that segfaults OpenCV would blank the
  // whole session's codes, and verify-plates.ts would misclassify every plate
  // as `unreadable` with no way to tell "the decoder crashed" from "the QR is
  // genuinely blank". Re-run each image in its own subprocess so only the
  // offending image loses its codes.
  //
  // Deliberately scoped to `crashed` (non-zero exit): a spawn failure or an
  // exit-0-with-garbage response is a protocol/environment problem that would
  // simply repeat N more times, and a single-image batch has nothing to
  // isolate it from.
  if (outcome.kind === 'crashed' && imagePaths.length > 1) {
    console.warn(
      `[QR Reader] Batch decode crashed — retrying ${imagePaths.length} image(s) individually to isolate the failure`
    );
    const isolated: QrCodeResult[] = [];
    for (const imagePath of imagePaths) {
      const single = await runDecodeSubprocess([imagePath]);
      if (single.kind === 'ok') {
        isolated.push(alignResults([imagePath], single.results)[0]);
      } else {
        console.error(
          `[QR Reader] Individual retry failed for ${path.basename(imagePath)} — no codes for this image`
        );
        isolated.push(emptyResults([imagePath])[0]);
      }
    }
    return isolated;
  }

  return emptyResults(imagePaths);
}

/** One `{ path, codes: [] }` entry per requested path. */
function emptyResults(imagePaths: string[]): QrCodeResult[] {
  return imagePaths.map((imagePath) => {
    const codes: string[] = [];
    return { path: imagePath, codes };
  });
}

/**
 * Read QR codes from a batch of scan images in a single subprocess spawn.
 *
 * @param imagePaths - Paths to TIFF/PNG/JPEG scan images
 * @returns One `{ path, codes }` entry per input path, in input order. Never
 *          rejects: any failure yields empty `codes` for the affected paths.
 */
export async function readQrCodesBatch(
  imagePaths: string[]
): Promise<QrCodeResult[]> {
  if (imagePaths.length === 0) return [];

  const run = qrReadQueue.then(() => decodeBatch(imagePaths));

  // The queue tail must NEVER be a rejected promise. `decodeBatch` is written
  // not to reject, but if it ever did, chaining the raw promise would leave
  // `qrReadQueue` permanently rejected and every subsequent call would reject
  // with it — breaking the documented "never rejects" contract for the rest
  // of the process's life, not just for the one bad batch.
  qrReadQueue = run.catch((): void => {});

  try {
    return await run;
  } catch (error) {
    console.error(
      '[QR Reader] Unexpected failure decoding batch:',
      error instanceof Error ? error.message : error
    );
    return emptyResults(imagePaths);
  }
}

/**
 * Read QR codes from a single scan image.
 *
 * Convenience wrapper over `readQrCodesBatch()`. Prefer the batch form when
 * decoding more than one image — each call here costs its own subprocess.
 *
 * @param imagePath - Path to a TIFF/PNG/JPEG scan image
 * @returns Decoded QR code strings, or an empty array if none found/on error
 */
export async function readQrCodes(imagePath: string): Promise<string[]> {
  const [result] = await readQrCodesBatch([imagePath]);
  return result ? result.codes : [];
}
