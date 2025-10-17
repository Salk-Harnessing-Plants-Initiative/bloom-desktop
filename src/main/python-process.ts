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
 *     - IMAGE:data:image/png;base64,<base64> - Base64-encoded images (future use)
 */

import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

// Timeout configuration
const STARTUP_TIMEOUT_MS = 5000; // Time to wait for Python process to become ready
const COMMAND_TIMEOUT_MS = 30000; // Time to wait for command response

/**
 * Events emitted by PythonProcess:
 *   - 'status': (message: string) => void - Status update from Python
 *   - 'error': (error: string) => void - Error from Python
 *   - 'data': (data: any) => void - JSON data response from Python
 *   - 'image': (dataUri: string) => void - Base64-encoded image (data:image/png;base64,...)
 *   - 'exit': (code: number | null) => void - Process exited
 *   - 'raw': (line: string) => void - Unrecognized output line
 */
export class PythonProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private pythonPath: string;
  private scriptArgs: string[];
  private stdinBuffer: string = '';

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
  }

  /**
   * Start the Python subprocess.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Process already started');
    }

    return new Promise((resolve, reject) => {
      try {
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
          this.emit('exit', code);
          this.process = null;
        });

        // Handle process errors
        this.process.on('error', (error: Error) => {
          reject(error);
        });

        // Wait for ready status
        const readyHandler = (message: string) => {
          if (message.includes('ready')) {
            this.removeListener('status', readyHandler);
            resolve();
          }
        };
        this.on('status', readyHandler);

        // Timeout if not ready
        setTimeout(() => {
          this.removeListener('status', readyHandler);
          reject(new Error('Python process startup timeout'));
        }, STARTUP_TIMEOUT_MS);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the Python subprocess.
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * Restart the Python subprocess.
   */
  async restart(): Promise<void> {
    this.stop();
    await new Promise((resolve) => setTimeout(resolve, 100)); // Brief delay
    await this.start();
  }

  /**
   * Send a command to the Python subprocess.
   *
   * @param command - Command object to send as JSON
   * @returns Promise that resolves with the response data
   */
  async sendCommand(command: object): Promise<any> {
    if (!this.process || !this.process.stdin) {
      throw new Error('Process not started');
    }

    return new Promise((resolve, reject) => {
      // Set up one-time listeners for response
      const dataHandler = (data: any) => {
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        resolve(data);
      };

      const errorHandler = (error: string) => {
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        reject(new Error(error));
      };

      this.once('data', dataHandler);
      this.once('error', errorHandler);

      // Send command as line-delimited JSON
      const commandJson = JSON.stringify(command);
      this.process.stdin!.write(`${commandJson}\n`);

      // Timeout for command response
      setTimeout(() => {
        this.removeListener('data', dataHandler);
        this.removeListener('error', errorHandler);
        reject(new Error('Command timeout'));
      }, COMMAND_TIMEOUT_MS);
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
    // Accumulate data in buffer
    this.stdinBuffer += data.toString();

    // Process complete lines
    const lines = this.stdinBuffer.split('\n');
    // Keep incomplete line in buffer
    this.stdinBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      this.parseLine(trimmedLine);
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
      const message = line.substring(6);
      this.emit('error', message);
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
