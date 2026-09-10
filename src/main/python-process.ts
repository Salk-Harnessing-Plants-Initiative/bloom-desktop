/**
 * Python Process Manager
 *
 * Base class for spawning and managing Python subprocesses that communicate
 * via stdin/stdout using a line-based protocol.
 *
 * Protocol:
 *   Input (stdin): Line-delimited JSON commands
 *   Output (stdout): Protocol messages with prefixes:
 *     - STATUS:<message> - Status updates
 *     - ERROR:<message> - Error messages
 *     - DATA:<json> - JSON data responses
 *     - IMAGE:data:image/jpeg;base64,<base64> - Base64-encoded images (future use)
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

// Timeout configuration
// Windows requires much longer timeout due to antivirus scanning and DLL loading of PyInstaller executables
// CI evidence shows Windows can take 30+ seconds to start the Python process
const STARTUP_TIMEOUT_MS = process.platform === 'win32' ? 60000 : 15000; // Time to wait for initial "ready" signal from Python process (startup only, not for command responses)
const COMMAND_TIMEOUT_MS = 180000; // 3 minutes - scanner scans can take longer on slow CI machines

// Prefixes that are legitimate, pre-existing Python-side diagnostic output
// but not part of the formal protocol (STATUS:/ERROR:/DATA:/IMAGE:, or a
// subclass's own prefixes) — e.g. daq.py's cleanup warnings, or
// detect_cameras()'s hardware-enumeration diagnostics. Matched via exact,
// case-sensitive prefix so a line resembling but not matching one of these
// (e.g. "WARNINGLY:") is still treated as unrecognized. New benign,
// unprefixed Python stdout lines must be added to
// UNRECOGNIZED_LINE_WARNING_ALLOWLIST below, not here — a prefix allowlist
// can't match a prefix-less line (#318).
const UNRECOGNIZED_PREFIX_ALLOWLIST = ['WARNING:', 'INFO:'];

// Exact-match allowlist for known-benign, prefix-less Python stdout lines
// (#318) — e.g. camera_mock.py's fallback-pattern message when no test
// image fixtures are present, which is common on CI/dev machines.
const UNRECOGNIZED_LINE_WARNING_ALLOWLIST = [
  'Generating synthetic test patterns instead',
];

const UNRECOGNIZED_LINE_WARNING_PREVIEW_LENGTH = 200;

/**
 * Events emitted by PythonProcess:
 *   - 'status': (message: string) => void - Status update from Python
 *   - 'error': (error: string, id?: number) => void - Error from Python.
 *     `id` correlates to a specific in-flight sendCommand() request when
 *     present (#47); undefined for unattributable errors (e.g. a raw
 *     stderr line, or an async streaming-thread error).
 *   - 'data': (data: any) => void - JSON data response from Python. May
 *     include an `id` field correlating it to a specific sendCommand()
 *     request (#47).
 *   - 'image': (dataUri: string) => void - Base64-encoded image (data:image/jpeg;base64,...)
 *   - 'exit': (code: number | null) => void - Process exited
 *   - 'raw': (line: string) => void - Unrecognized output line
 */
interface PendingRequest {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export class PythonProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private pythonPath: string;
  private scriptArgs: string[];
  private stdoutChunks: Buffer[] = [];
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();

  // Incremented on every start() call and captured by that call's own
  // 'exit' handler closure. restart()'s stop() doesn't wait for the old
  // process's real OS-level exit — if that exit event arrives late (after
  // a new process has already started), the handler compares its
  // captured generation against the current one to recognize itself as
  // stale and no-op, rather than nulling out the new process reference
  // or rejecting the new generation's in-flight requests.
  private generation = 0;

  // Memoizes an in-flight restart() so concurrent calls (e.g. a user
  // double-clicking "Restart Python") share the same stop()-then-start()
  // operation instead of racing two independent ones.
  private restartPromise: Promise<void> | null = null;

  /**
   * Create a new Python process manager.
   *
   * @param pythonPath - Path to Python executable
   * @param scriptArgs - Arguments to pass to Python script
   */
  constructor(pythonPath: string, scriptArgs: string[] = ['--ipc']) {
    super();
    this.pythonPath = pythonPath;
    this.scriptArgs = scriptArgs;
    this.registerCorrelationListeners();
    this.registerUnrecognizedLineWarning();
  }

  /**
   * Logs a warning for any stdout line that doesn't match a recognized
   * protocol prefix (#318) — a safety net for the general failure class
   * behind #316, where a corrupted/dropped protocol line was invisible
   * until it silently manifested as an opaque 180s command timeout. Does
   * not change the existing `'raw'` event, which still fires unconditionally
   * for any explicit listener; this only adds a default console.warn.
   *
   * Excludes lines matching UNRECOGNIZED_PREFIX_ALLOWLIST/
   * UNRECOGNIZED_LINE_WARNING_ALLOWLIST — already-legitimate, pre-existing
   * informal Python output that isn't part of the formal protocol but also
   * isn't evidence of corruption.
   */
  private registerUnrecognizedLineWarning(): void {
    this.on('raw', (line: string) => {
      const isAllowlisted =
        UNRECOGNIZED_PREFIX_ALLOWLIST.some((prefix) =>
          line.startsWith(prefix)
        ) || UNRECOGNIZED_LINE_WARNING_ALLOWLIST.includes(line);
      if (isAllowlisted) return;

      // Code-point-safe truncation: line.slice() operates on UTF-16 code
      // units and could split a surrogate pair (e.g. an emoji) in half,
      // producing a mojibake/replacement-char preview.
      const preview = Array.from(line)
        .slice(0, UNRECOGNIZED_LINE_WARNING_PREVIEW_LENGTH)
        .join('');
      console.warn(`[PythonProcess] Unrecognized protocol line: ${preview}`);
    });
  }

  /**
   * Registers the persistent listeners that correlate incoming `data`/
   * `error` events to the `pendingRequests` map, keyed by request id
   * (#47). Registered once, in the constructor — unlike the old
   * per-call `once('data'/'error', ...)` pattern, these listeners never
   * consume an event meant for a different in-flight command.
   */
  private registerCorrelationListeners(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.on('data', (data: any) => {
      const id = data?.id;
      if (id === undefined || id === null) return;
      const pending = this.pendingRequests.get(id);
      if (!pending) return; // Stale (already timed out) or unrelated id.
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);
      pending.resolve(data);
    });

    this.on('error', (message: string, id?: number) => {
      if (id !== undefined && id !== null) {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(id);
          pending.reject(new Error(message));
        }
        return;
      }
      // Unattributable error (e.g. a raw stderr line, a fatal top-level
      // exception, or an untagged streaming-thread error) — reject every
      // currently-pending request rather than leaving them all to time out.
      this.rejectAllPending(new Error(message));
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);
      pending.reject(error);
    }
  }

  /**
   * Start the Python subprocess.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Process already started');
    }

    const myGeneration = ++this.generation;

    return new Promise((resolve, reject) => {
      try {
        // Set up ready handler BEFORE spawning to avoid race condition
        const readyHandler = (message: string) => {
          if (message.includes('ready')) {
            this.removeListener('status', readyHandler);
            clearTimeout(timeoutId);
            resolve();
          }
        };
        this.on('status', readyHandler);

        // Timeout if not ready
        const timeoutId = setTimeout(() => {
          this.removeListener('status', readyHandler);
          reject(new Error('Python process startup timeout'));
        }, STARTUP_TIMEOUT_MS);

        // Spawn Python process
        this.process = spawn(this.pythonPath, this.scriptArgs, {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle stdout (protocol messages)
        this.process.stdout?.on('data', (data: Buffer) => {
          this.handleStdout(data);
        });

        // Handle stderr (errors)
        this.process.stderr?.on('data', (data: Buffer) => {
          const errorMessage = data.toString().trim();
          if (errorMessage) {
            this.emit('error', errorMessage);
          }
        });

        // Handle process exit
        this.process.on('exit', (code: number | null) => {
          // A stale exit event from a process generation already
          // superseded by a subsequent restart() — ignore entirely, so
          // it can't null out the new process reference or misattribute
          // a rejection to the new generation's in-flight requests.
          if (myGeneration !== this.generation) return;

          // Reject every in-flight command immediately rather than leaving
          // each one to individually time out — the process is confirmed
          // gone, so no pending command will ever get a real response.
          this.process = null;
          this.rejectAllPending(
            new Error(`Python process exited with code ${code}`)
          );
          this.emit('exit', code);
        });

        // Handle process errors
        this.process.on('error', (error: Error) => {
          clearTimeout(timeoutId);
          this.removeListener('status', readyHandler);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the Python subprocess.
   *
   * Rejects any currently-pending requests immediately, rather than
   * relying on the real (possibly delayed, possibly asynchronous) process
   * `exit` event to do it — that event's generation guard (see `start()`)
   * intentionally no-ops once a subsequent `start()` has begun a new
   * generation, so without this, a request that was genuinely orphaned by
   * this `stop()` call would otherwise sit waiting for its own
   * `COMMAND_TIMEOUT_MS` (3 minutes) instead of failing fast.
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
      this.rejectAllPending(new Error('Python process stopped'));
    }
    // Clear stdout buffer
    this.stdoutChunks = [];
  }

  /**
   * Restart the Python subprocess.
   *
   * Concurrent calls (e.g. a user double-clicking "Restart Python" with
   * no disabled-while-restarting UI guard) share the same in-flight
   * restart rather than racing two independent stop()-then-start()
   * sequences against each other.
   */
  async restart(): Promise<void> {
    if (this.restartPromise) {
      return this.restartPromise;
    }
    this.restartPromise = this.performRestart().finally(() => {
      this.restartPromise = null;
    });
    return this.restartPromise;
  }

  private async performRestart(): Promise<void> {
    this.stop();
    await new Promise((resolve) => setTimeout(resolve, 100)); // Brief delay
    await this.start();
  }

  /**
   * Send a command to the Python subprocess.
   *
   * The command is tagged with an incrementing request id (#47), so its
   * response — matched via the persistent `data`/`error` listeners set up
   * in {@link registerCorrelationListeners} — resolves/rejects only this
   * call's promise, even if other `sendCommand()` calls are in flight
   * concurrently.
   *
   * @param command - Command object to send as JSON
   * @returns Promise that resolves with the response data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendCommand(command: object): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Process not started');
    }

    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Command timeout'));
      }, COMMAND_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      // Send command as line-delimited JSON, tagged with its request id.
      const commandJson = JSON.stringify({ ...command, id });
      this.process!.stdin!.write(`${commandJson}\n`);
    });
  }

  /**
   * Check if the process is running.
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * Handle stdout data from Python process.
   * Parses line-based protocol messages.
   *
   * @param data - Buffer data from stdout
   */
  private handleStdout(data: Buffer): void {
    // Skip empty chunks
    if (data.length === 0) return;

    // Check if this chunk contains a newline
    let newlineIndex = data.indexOf(0x0a); // '\n'

    if (newlineIndex === -1) {
      // No newline — just accumulate (copy to release parent buffer)
      this.stdoutChunks.push(Buffer.from(data));
      return;
    }

    // Process all complete lines in this chunk
    let offset = 0;
    while (newlineIndex !== -1) {
      // Extract the portion up to the newline
      const chunk = Buffer.from(data.subarray(offset, newlineIndex));
      this.stdoutChunks.push(chunk);

      // Concatenate all accumulated chunks into one string
      const line = Buffer.concat(this.stdoutChunks).toString().trim();
      this.stdoutChunks = [];

      if (line) {
        this.parseLine(line);
      }

      offset = newlineIndex + 1;
      newlineIndex = data.indexOf(0x0a, offset);
    }

    // Keep any remaining data after the last newline as a partial chunk
    if (offset < data.length) {
      this.stdoutChunks.push(Buffer.from(data.subarray(offset)));
    }
  }

  /**
   * Parse a protocol line and emit appropriate events.
   *
   * @param line - Line to parse
   */
  protected parseLine(line: string): void {
    if (line.startsWith('STATUS:')) {
      const message = line.substring(7);
      this.emit('status', message);
    } else if (line.startsWith('ERROR:')) {
      // The Python side (#47) sends a JSON envelope: {"message": "...",
      // "id"?: number}, the id present only when correlated to a specific
      // command. Fall back to treating the raw text as the message for
      // any non-JSON payload (defensive — shouldn't happen with the
      // current send_error(), but keeps this parser robust either way).
      const rawPayload = line.substring(6);
      let message = rawPayload;
      let id: number | undefined;
      try {
        const parsed = JSON.parse(rawPayload);
        if (parsed && typeof parsed.message === 'string') {
          message = parsed.message;
          id = typeof parsed.id === 'number' ? parsed.id : undefined;
        }
      } catch {
        // Not JSON — use the raw text as-is, with no id.
      }
      this.emit('error', message, id);
    } else if (line.startsWith('DATA:')) {
      const jsonStr = line.substring(5);
      try {
        const data = JSON.parse(jsonStr);
        this.emit('data', data);
      } catch {
        this.emit('error', `Invalid JSON: ${jsonStr}`);
      }
    } else if (line.startsWith('IMAGE:')) {
      // Future use for camera images
      const dataUri = line.substring(6);
      this.emit('image', dataUri);
    } else {
      // Unrecognized line - emit as raw output
      this.emit('raw', line);
    }
  }
}
