## ADDED Requirements

### Requirement: Diagnostics Log Sink

The application SHALL provide a diagnostics log that writes timestamped entries to `~/.bloom/logs/diagnostics-YYYY-MM-DD.log` in **both** CylinderScan and GraviScan modes. Timestamps SHALL be ISO-8601 **UTC** with a `Z` suffix, and the daily filename SHALL be derived from the UTC date. All entries SHALL be written through a single synchronous append path, so that every entry is on disk before the writing call returns and the file is always in total write order. Logging failures SHALL never propagate to callers. The log file SHALL be created with mode `0600` and its directory with mode `0700`.

A single append path is required because the forensic value of this log is that its last entries describe the moment the app stopped working. A buffered stream alongside a synchronous path could interleave mid-line and emit entries out of order, which would invalidate that reading.

#### Scenario: Entries are written with a UTC timestamp in either scanner mode

- **GIVEN** the application has started in either `cylinderscan` or `graviscan` mode
- **WHEN** a diagnostics entry is written
- **THEN** the line SHALL be appended to `~/.bloom/logs/diagnostics-<UTC-today>.log`
- **AND** the line SHALL begin with an ISO-8601 timestamp ending in `Z`

#### Scenario: Log directory and file are created with restrictive modes

- **GIVEN** `~/.bloom/logs/` does not exist
- **WHEN** the first diagnostics entry is written
- **THEN** the directory SHALL be created recursively with mode `0700`
- **AND** the log file SHALL be created with mode `0600`

#### Scenario: Entries are on disk before the write call returns

- **GIVEN** a diagnostics entry is written
- **WHEN** the writing call returns
- **THEN** the entry SHALL already be readable from the log file
- **AND** it SHALL NOT depend on a later buffered flush

#### Scenario: Entries appear in the file in write order

- **GIVEN** three diagnostics entries are written in sequence
- **WHEN** the log file is read
- **THEN** the three entries SHALL appear in the order written
- **AND** each SHALL occupy exactly one complete line

#### Scenario: Durability is bounded to process death, not power loss

- **GIVEN** a diagnostics entry has been written and the call has returned
- **WHEN** the process is killed with `SIGKILL`
- **THEN** the entry SHALL be present on disk, because the write reached the OS page cache
- **AND** durability across power loss or kernel panic SHALL NOT be claimed, since no `fsync` is performed

#### Scenario: A failing filesystem never breaks the caller

- **GIVEN** the log file cannot be opened or written
- **WHEN** a diagnostics entry is written
- **THEN** no exception SHALL propagate to the caller

#### Scenario: Log rotates when the UTC date changes

- **GIVEN** entries were previously written to `diagnostics-2026-09-22.log`
- **WHEN** an entry is written after the UTC date has rolled over to 2026-09-23
- **THEN** the entry SHALL be written to `diagnostics-2026-09-23.log`

#### Scenario: Newlines in logged content cannot forge log lines

- **GIVEN** content to be logged contains a newline character
- **WHEN** the entry is written
- **THEN** the newline SHALL be escaped so the entry occupies one line
- **AND** it SHALL NOT be possible for logged content to produce a line resembling a breadcrumb record

### Requirement: Diagnostics Log Write-Failure Visibility

A silently failing log makes negative inferences unsound: "no blocked-call record, therefore no blocked call" is false if every write has been failing. The diagnostics log SHALL therefore record its own loss of entries.

#### Scenario: First write failure is reported through another channel

- **GIVEN** diagnostics writes have been succeeding
- **WHEN** a write fails for the first time
- **THEN** the failure SHALL be reported once to standard error
- **AND** the subsystem SHALL be marked degraded

#### Scenario: Recovery records that entries were lost

- **GIVEN** one or more diagnostics writes have failed
- **WHEN** a later write succeeds
- **THEN** the log SHALL record that entries were lost and how many
- **AND** absence of entries SHALL therefore not be readable as absence of events

### Requirement: Diagnostics Log Volume Bounds

The diagnostics log SHALL be bounded in both age and size, so that a repeating fault cannot exhaust the volume that also holds scan data. Retention SHALL default to 180 days, matching the existing scan log, and be overridable via `BLOOM_DIAG_LOG_RETENTION_DAYS`. Cleanup SHALL run at startup and whenever the UTC date rolls over, because a rig may run unattended for months without restart.

#### Scenario: Retention prunes only this subsystem's old logs

- **GIVEN** `~/.bloom/logs/` contains `diagnostics-*.log` files older than the retention window, `diagnostics-*.log` files within it, and `graviscan-*.log` files
- **WHEN** retention cleanup runs
- **THEN** only the out-of-window `diagnostics-*.log` files SHALL be deleted
- **AND** `graviscan-*.log` files SHALL NOT be deleted

#### Scenario: Retention window is configurable with a safe fallback

- **GIVEN** `BLOOM_DIAG_LOG_RETENTION_DAYS` is set to a valid positive number
- **WHEN** cleanup runs
- **THEN** that value SHALL be used as the retention window
- **AND** an absent, non-numeric, zero, or negative value SHALL fall back to 180 days

#### Scenario: Cleanup also runs on date rollover

- **GIVEN** the application has been running since before the UTC date changed
- **WHEN** the date rolls over and an entry is written
- **THEN** retention cleanup SHALL run again without requiring a restart

#### Scenario: A repeating fault cannot fill the disk

- **GIVEN** a fault is producing identical diagnostics entries repeatedly
- **WHEN** the same entry signature recurs within a short window
- **THEN** recurrences SHALL be counted and summarised rather than written individually

#### Scenario: Per-day size cap truncates explicitly

- **GIVEN** the current day's diagnostics log has reached its byte cap
- **WHEN** a further entry is written
- **THEN** one final `LOG-CAPPED` entry SHALL be written
- **AND** no further entries SHALL be written to that day's file

#### Scenario: Deleting a log held open by another instance does not fail

- **GIVEN** another application instance holds a diagnostics log file open
- **WHEN** retention cleanup attempts to delete it
- **THEN** the failure SHALL be tolerated and cleanup SHALL continue with the remaining files

### Requirement: Diagnostics Run Identity

Each run SHALL write a `RUN-START` entry when diagnostics initialise and a `RUN-END` entry on `before-quit`. Without run identity, an unmatched record left by a process that was killed is indistinguishable from one belonging to the live process, because both append to the same daily file — and a restart shortly after a freeze is exactly when someone reads the file.

`RUN-START` SHALL record: the process id, a per-run identifier, the application version, the Electron, Chromium, and Node versions, `process.platform` and architecture, the scanner mode, and the resolved values of every diagnostics threshold actually in force.

#### Scenario: Run start records identity and effective configuration

- **WHEN** diagnostics initialise
- **THEN** a `RUN-START` entry SHALL record the process id, run identifier, application version, Electron/Chromium/Node versions, platform, architecture, scanner mode, and the thresholds in force

#### Scenario: A previous run's entries are distinguishable

- **GIVEN** the diagnostics log already contains entries from a process that was killed earlier the same day
- **WHEN** a new process appends to the same daily file
- **THEN** every entry SHALL carry a run identifier
- **AND** the previous run's entries SHALL be distinguishable from the current run's

#### Scenario: Thresholds in force are recorded, not assumed

- **GIVEN** a threshold has been overridden by an environment variable
- **WHEN** `RUN-START` is written
- **THEN** it SHALL record the effective value
- **AND** a reader SHALL therefore be able to tell a quiet run from a run with reporting effectively disabled

#### Scenario: Run end is recorded on quit

- **WHEN** the application handles `before-quit`
- **THEN** a `RUN-END` entry SHALL be written before the process exits

### Requirement: Diagnostics Never Record Secrets

The diagnostics log exists to be read and shared, including by pasting into issues and pull requests. It SHALL therefore never record credentials. IPC argument values and return values SHALL NOT be recorded. Logged error text SHALL be redacted.

This is not hypothetical: `config:fetch-scanners` receives `bloom_scanner_password` and `bloom_anon_key` as arguments, `config:set` receives a full machine configuration including the Slack webhook URL, and `config:get` returns `bloom_anon_key` unmasked. The codebase already treats these as secrets — `config:get` masks the password, `config:get-graviscan-env-status` returns only a boolean, and the Slack notifier deliberately logs `err.name` rather than `err.message` so a request URL cannot leak.

#### Scenario: Credential-bearing arguments are never recorded

- **GIVEN** `config:fetch-scanners` is invoked with a credentials argument
- **WHEN** any diagnostics entry is written for that invocation
- **THEN** no argument value SHALL appear in the log
- **AND** neither the password nor the anon key SHALL appear anywhere in the log

#### Scenario: Return values are never recorded

- **GIVEN** an instrumented channel returns a value containing a secret
- **WHEN** any diagnostics entry is written for that invocation
- **THEN** no part of the return value SHALL appear in the log

#### Scenario: URLs in logged error text are redacted

- **GIVEN** an error message contains a URL with a path, query, or user-info component
- **WHEN** it is recorded
- **THEN** the path, query, and user-info SHALL be redacted, leaving at most scheme and host

#### Scenario: Known secret values are masked wherever they appear

- **GIVEN** a configured secret value is known to the application
- **WHEN** any diagnostics entry would contain that exact substring
- **THEN** the substring SHALL be masked before the entry is written

### Requirement: Local Crash Report Capture

The application SHALL start Electron's `crashReporter` before the app `ready` event with `uploadToServer: false`, so native crashes of the main, renderer, and GPU processes write minidumps locally without transmitting anything off the machine. Starting before `ready` is required for renderer and GPU coverage.

The resolved crash-dump directory is platform-dependent (`~/.config/<productName>/Crashpad` on Linux, `%APPDATA%\<productName>\Crashpad` on Windows, `~/Library/Application Support/<productName>/Crashpad` on macOS, each with `pending/` and `completed/` subdirectories) and SHALL therefore be resolved at runtime and recorded rather than documented as a fixed path.

Minidumps contain process memory. In this application that memory includes the process environment block, into which the Slack webhook URL is written, along with heap-resident machine configuration and session tokens. Minidumps SHALL therefore be treated as credential-bearing.

#### Scenario: Crash reporting is active before any renderer exists

- **WHEN** the application starts
- **THEN** `crashReporter.start()` SHALL have been called before the `ready` event
- **AND** it SHALL be configured with `uploadToServer: false`

#### Scenario: Resolved crash-dump directory is recorded

- **WHEN** crash reporting is started
- **THEN** the runtime-resolved crash-dump directory SHALL be recorded in the diagnostics log

#### Scenario: Crash-dump directory growth is bounded

- **GIVEN** repeated native crashes have accumulated minidumps
- **WHEN** retention cleanup runs
- **THEN** minidumps beyond the configured age or count limit SHALL be removed

#### Scenario: A JavaScript exception produces no minidump

- **GIVEN** an uncaught JavaScript exception occurs rather than a native crash
- **WHEN** it is handled
- **THEN** no minidump SHALL be expected
- **AND** the diagnostics log SHALL be the record of that event

#### Scenario: Starting crash reporting is recorded as a process-tree change

- **WHEN** `crashReporter.start()` is called
- **THEN** the diagnostics log SHALL record that a crash-handler child process has been started
- **AND** a reader inspecting the process tree SHALL therefore not mistake it for an unexpected child

### Requirement: Main-Process Event-Loop Lag Monitoring

The application SHALL monitor main-process event-loop delay and record breaches. This matters because a synchronous block on the main process stops OS input being dispatched to the renderer while the window continues to present its last composited frame — the application appears frozen while every process sleeps at near-zero CPU.

Delay SHALL be measured with `perf_hooks.monitorEventLoopDelay`, whose histogram reports **nanoseconds**; values SHALL be converted to milliseconds before comparison and before being recorded. The reporting threshold SHALL default to 1000 ms, overridable via `BLOOM_DIAG_LOOP_LAG_WARN_MS`, and a breach SHALL be reported when measured lag is strictly greater than the threshold. The sampling interval and histogram resolution SHALL be recorded in `RUN-START`, since a reader cannot interpret the absence of warnings without knowing the sampling cadence.

Two limitations SHALL be documented rather than left to be discovered. A block is reported only **after** it ends, because while the loop is blocked the sampler cannot run; a block that never ends before the process is killed produces no lag entry at all, which is why IPC breadcrumbs exist. And a block occurring before the loop begins iterating — during module evaluation at startup — is not measurable as loop delay.

#### Scenario: A synchronous block is reported in milliseconds after it ends

- **GIVEN** lag monitoring is active with a threshold of 1000 ms
- **WHEN** the main-process event loop is blocked for approximately three seconds inside a callback
- **THEN** once the loop resumes, a diagnostics entry SHALL record the observed maximum lag
- **AND** the recorded value SHALL be expressed in milliseconds, not nanoseconds

#### Scenario: Normal operation produces no lag warnings

- **GIVEN** lag monitoring is active
- **WHEN** the event loop is never delayed beyond the threshold
- **THEN** no lag warning SHALL be written

#### Scenario: A single block produces a single report

- **GIVEN** a breach has been reported
- **WHEN** subsequent samples are taken over a quiet period
- **THEN** no further entries SHALL be written for the same block

#### Scenario: Lag exactly at the threshold is not reported

- **GIVEN** the threshold is 1000 ms
- **WHEN** the measured maximum lag is exactly 1000 ms
- **THEN** no breach SHALL be reported

#### Scenario: Threshold is configurable with a safe fallback

- **GIVEN** `BLOOM_DIAG_LOOP_LAG_WARN_MS` is set to a valid positive number
- **WHEN** lag monitoring starts
- **THEN** that value SHALL be used as the threshold
- **AND** an absent, non-numeric, zero, or negative value SHALL fall back to 1000 ms

#### Scenario: A lag breach dumps in-flight IPC

- **GIVEN** one or more IPC handlers are in flight
- **WHEN** a lag breach is reported
- **THEN** the in-flight IPC records SHALL be written to the diagnostics log

#### Scenario: Monitoring stops cleanly on quit

- **GIVEN** lag monitoring is active
- **WHEN** the application handles `before-quit`
- **THEN** the monitor SHALL be stopped and its sampling timer cleared
- **AND** stopping twice SHALL NOT throw

### Requirement: Renderer Responsiveness Logging

The application SHALL log renderer responsiveness transitions using `webContents.on('unresponsive')` and `webContents.on('responsive')`, recording how long the renderer was unresponsive when it recovers. Listeners SHALL be attached to every main window's `webContents` at creation, not once at startup, because the application recreates its window on `activate` when no windows remain — a freeze after reactivation must not be invisible.

#### Scenario: Blocked renderer is recorded

- **GIVEN** the main window's renderer main thread stops responding
- **WHEN** Electron emits `unresponsive`
- **THEN** a diagnostics entry SHALL record that the renderer became unresponsive

#### Scenario: Recovery records the blocked duration in milliseconds

- **GIVEN** the renderer was previously reported unresponsive
- **WHEN** Electron emits `responsive`
- **THEN** a diagnostics entry SHALL record the recovery and the elapsed unresponsive duration in milliseconds

#### Scenario: A recreated window is still monitored

- **GIVEN** the main window has been destroyed and a new one created
- **WHEN** the new window's renderer stops responding
- **THEN** the transition SHALL still be recorded

#### Scenario: In-flight IPC is dumped when the renderer blocks

- **GIVEN** one or more IPC handlers are in flight
- **WHEN** the renderer becomes unresponsive
- **THEN** the in-flight IPC records SHALL be written to the diagnostics log

### Requirement: Process Loss Logging

The application SHALL log renderer and child-process termination, recording process type, reason, and exit code. Renderer loss SHALL be observed via `render-process-gone` on the affected `webContents`; child-process loss SHALL be observed via `child-process-gone` on `app`. This SHALL be understood to cover Chromium child processes only — it does not observe the application's own spawned Python scan workers.

#### Scenario: GPU process crash is recorded

- **WHEN** the GPU process exits unexpectedly and Electron emits `child-process-gone` with type `GPU`
- **THEN** a diagnostics entry SHALL record the type, reason, and exit code

#### Scenario: Renderer loss is recorded

- **WHEN** Electron emits `render-process-gone`
- **THEN** a diagnostics entry SHALL record the reason and exit code

### Requirement: Unhandled Main-Process Error Logging

The main process SHALL record unhandled errors rather than losing them to a discarded stdout stream, **without** altering the process's existing crash behaviour.

Uncaught exceptions SHALL be observed via `process.on('uncaughtExceptionMonitor')`, which logs while leaving Node's default handling intact. A plain `uncaughtException` listener SHALL NOT be used: registering one replaces Node's default print-and-exit, turning a hard crash into a process limping on in corrupted state — worse than the fault being diagnosed. `unhandledRejection` has no monitor variant, so its handler SHALL log and then restore the default behaviour.

Recorded error content SHALL be constrained: for `Error` reasons, the name, stack, and a redacted message; for non-`Error` reasons, the type and constructor name only. A non-`Error` rejection reason SHALL NOT be serialised, because a rejected value may itself be or reference a machine configuration holding credentials.

#### Scenario: Uncaught exception is recorded without suppressing exit

- **WHEN** an uncaught exception reaches the main process
- **THEN** a diagnostics entry SHALL record its name, stack, and redacted message
- **AND** the process SHALL still terminate with its pre-existing non-zero exit code

#### Scenario: Unhandled rejection is recorded and default behaviour restored

- **WHEN** a promise rejection goes unhandled in the main process
- **THEN** a diagnostics entry SHALL record it
- **AND** the process's default `unhandledRejection` behaviour SHALL be preserved

#### Scenario: A non-Error rejection reason is not serialised

- **GIVEN** a promise rejects with a plain object rather than an `Error`
- **WHEN** the rejection is recorded
- **THEN** the entry SHALL record only its type and constructor name
- **AND** it SHALL NOT contain any of the object's property values

#### Scenario: Secrets in error text do not reach the log

- **GIVEN** an unhandled rejection's reason contains the Slack webhook URL or a credential
- **WHEN** the rejection is recorded
- **THEN** the entry SHALL contain neither

### Requirement: Freeze Indicator Scan Context

When a freeze indicator fires, the entry SHALL record the scan work in progress where the main process knows it — session, experiment, wave, scanner identity, and whether a scan is active. A scientist's question after a freeze is whether the affected data is suspect, and answering it must not require manually time-correlating two log files with different retention.

#### Scenario: A freeze during a scan names the affected work

- **GIVEN** a scan session is in progress
- **WHEN** a freeze indicator fires
- **THEN** the entry SHALL record the in-progress session, experiment, wave, and scanner identity

#### Scenario: A freeze outside a scan records that no scan was active

- **GIVEN** no scan session is in progress
- **WHEN** a freeze indicator fires
- **THEN** the entry SHALL record that no scan was active

#### Scenario: A correlating pointer is written to the scan log

- **GIVEN** a freeze indicator fires while GraviScan logging is active
- **WHEN** the diagnostics entry is written
- **THEN** a correlating entry SHALL also be written to the scan log
- **AND** the 180-day scientific record SHALL therefore contain a pointer to the diagnostics record

### Requirement: Diagnostics Subsystem Toggle

The diagnostics subsystem SHALL be enabled by default, so an unattended freeze is captured without anyone having remembered to set a flag, and SHALL be fully disableable via `BLOOM_DIAGNOSTICS=0`. Only the exact value `0`, after trimming surrounding whitespace, SHALL disable it; any other value SHALL leave diagnostics enabled.

`BLOOM_DIAGNOSTICS` and the `BLOOM_DIAG_*` thresholds SHALL be documented as **launch-environment** variables. They are read before the application hydrates `~/.bloom/.env`, and only three specific keys from that file ever reach `process.env`, so placing them in `~/.bloom/.env` has no effect and produces no error.

#### Scenario: Diagnostics are active without configuration

- **GIVEN** no diagnostics environment variables are set
- **WHEN** the application starts
- **THEN** the diagnostics subsystem SHALL be active with its default thresholds

#### Scenario: Diagnostics can be disabled entirely

- **GIVEN** `BLOOM_DIAGNOSTICS=0` is set in the launch environment
- **WHEN** the application starts
- **THEN** no diagnostics log file SHALL be created
- **AND** no event-loop monitor, IPC watchdog, or process listener SHALL be installed
- **AND** `crashReporter.start()` SHALL NOT be called

#### Scenario: Only the exact value zero disables diagnostics

- **GIVEN** `BLOOM_DIAGNOSTICS` is set to a value other than `0`, such as `false`, `off`, `1`, or the empty string
- **WHEN** the application starts
- **THEN** diagnostics SHALL remain enabled

#### Scenario: Writing entries is a no-op when disabled

- **GIVEN** diagnostics are disabled
- **WHEN** any code path attempts to write a diagnostics entry
- **THEN** no directory SHALL be created and no file SHALL be written
