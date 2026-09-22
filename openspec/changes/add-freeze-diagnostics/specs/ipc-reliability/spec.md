## ADDED Requirements

### Requirement: IPC Watchdog Installation

The application SHALL install a single instrumentation decorator over `ipcMain.handle` before the first IPC handler is registered, so all IPC channels are covered by one insertion point regardless of which module registers them. Installation SHALL be idempotent and reversible.

`ipcMain.handle` is an **own**, writable, configurable property of the `ipcMain` instance and is absent from its prototype. Uninstalling SHALL therefore restore a saved reference to the original function; deleting the property or restoring from the prototype would remove the method entirely.

`ipcMain.handleOnce` SHALL NOT be decorated and is unused in this codebase. Its absence from instrumentation SHALL be recorded, so a future handler registered through it is a known coverage gap rather than a silent one.

#### Scenario: All handlers are covered by one install

- **GIVEN** the decorator is installed before the first `ipcMain.handle` registration
- **WHEN** handlers are subsequently registered from the main entry point, from the database handler module which imports the `ipcMain` singleton directly, and from the GraviScan handler module which receives `ipcMain` as a parameter
- **THEN** every channel registered by all three SHALL be instrumented

#### Scenario: Installing twice does not double-wrap

- **GIVEN** the watchdog has already been installed
- **WHEN** installation is attempted again
- **THEN** handlers SHALL NOT be wrapped twice
- **AND** each invocation SHALL be recorded exactly once

#### Scenario: Uninstall restores the original function

- **GIVEN** the watchdog is installed
- **WHEN** it is uninstalled
- **THEN** `ipcMain.handle` SHALL be the original Electron function
- **AND** registering a handler afterwards SHALL still work

#### Scenario: Watchdog is not installed when diagnostics are disabled

- **GIVEN** `BLOOM_DIAGNOSTICS=0` is set
- **WHEN** the application starts
- **THEN** `ipcMain.handle` SHALL remain the original Electron implementation
- **AND** no invocation SHALL be recorded or breadcrumbed

### Requirement: IPC Watchdog Transparency

The watchdog SHALL be observationally transparent. Handler return shapes in this codebase are deliberately inconsistent — some return `{ success, data }`, some `{ success, error }`, some bare values — and several handlers intentionally rethrow, so the watchdog MUST NOT normalise them.

#### Scenario: Resolved values pass through verbatim

- **GIVEN** an instrumented handler resolves with a value
- **WHEN** the renderer invokes that channel
- **THEN** the renderer SHALL receive exactly that value, structurally unchanged

#### Scenario: Each real envelope shape is preserved

- **GIVEN** instrumented handlers returning a `{ success, data }` envelope, a `{ success, error }` envelope, and a bare non-object value
- **WHEN** each is invoked
- **THEN** each result SHALL be delivered in its original shape

#### Scenario: Rejections propagate with the original message

- **GIVEN** an instrumented handler returns a promise that rejects
- **WHEN** the renderer invokes that channel
- **THEN** the rejection SHALL propagate with the original error message
- **AND** the watchdog SHALL NOT convert it into a resolved value

#### Scenario: A synchronous throw still propagates and still settles bookkeeping

- **GIVEN** an instrumented handler throws synchronously rather than returning a rejected promise
- **WHEN** it is invoked
- **THEN** the error SHALL propagate with its original message
- **AND** the in-flight record SHALL be removed
- **AND** an end breadcrumb SHALL be written for a risk-listed channel

#### Scenario: A handler returning a non-promise works unchanged

- **GIVEN** an instrumented handler returns a plain value rather than a promise
- **WHEN** it is invoked
- **THEN** the caller SHALL receive that value
- **AND** the in-flight record SHALL be removed

#### Scenario: Handler arguments are forwarded unchanged

- **GIVEN** an instrumented handler expects an IPC event plus arguments
- **WHEN** the renderer invokes that channel with arguments
- **THEN** the handler SHALL receive the same event and arguments it would have received uninstrumented

#### Scenario: Duplicate channel registration still throws

- **GIVEN** a channel has already been registered through the decorated function
- **WHEN** the same channel is registered again
- **THEN** Electron's duplicate-handler error SHALL still be raised

#### Scenario: A slow handler is still allowed to complete

- **GIVEN** a handler exceeds its reporting threshold
- **WHEN** it eventually settles
- **THEN** its result SHALL still be delivered to the caller
- **AND** the watchdog SHALL NOT cancel, time out, or abort it

### Requirement: IPC Watchdog Records No Payloads

The watchdog SHALL record only a channel name, an invocation identifier, and a duration. It SHALL NOT record IPC argument values or return values, because instrumented channels carry credentials in both directions: `config:fetch-scanners` receives a password and anon key as arguments, `config:set` receives a full machine configuration, and `config:get` returns an unmasked anon key.

#### Scenario: Arguments are never recorded

- **GIVEN** any instrumented channel is invoked with arguments
- **WHEN** its diagnostics entries are written
- **THEN** no argument value SHALL appear in any entry

#### Scenario: Return values are never recorded

- **GIVEN** any instrumented channel resolves with a value
- **WHEN** its diagnostics entries are written
- **THEN** no part of the return value SHALL appear in any entry

#### Scenario: A credential-bearing channel leaks nothing

- **GIVEN** `config:fetch-scanners` is invoked with a password and anon key
- **WHEN** its breadcrumbs, any slow-call entry, and any in-flight dump are written
- **THEN** neither the password nor the anon key SHALL appear anywhere in the diagnostics log

### Requirement: Slow IPC Handler Detection

The watchdog SHALL record any IPC handler whose invocation-to-settle duration exceeds its threshold, naming the channel, the invocation identifier, and the measured duration. Durations SHALL carry an explicit `ms` unit. The general threshold SHALL default to 3000 ms, overridable via `BLOOM_DIAG_IPC_WARN_MS`, and a breach SHALL be reported when the duration is strictly greater than the threshold.

Channels that are legitimately slow but bounded SHALL have per-channel thresholds rather than being excluded, so a genuine regression still surfaces.

#### Scenario: A slow handler is reported with channel, invocation, and duration

- **GIVEN** a handler takes longer than its threshold to settle
- **WHEN** it settles
- **THEN** a diagnostics entry SHALL record the channel name, the invocation identifier, and the elapsed duration with an `ms` unit

#### Scenario: A fast handler is not reported

- **GIVEN** a handler settles well within its threshold
- **WHEN** it settles
- **THEN** no slow-handler entry SHALL be written

#### Scenario: A duration exactly at the threshold is not reported

- **GIVEN** a channel's threshold is 3000 ms
- **WHEN** a handler settles in exactly 3000 ms
- **THEN** no slow-handler entry SHALL be written

#### Scenario: A rejecting slow handler is still reported

- **GIVEN** a handler exceeds its threshold and then rejects
- **WHEN** it settles
- **THEN** the slow-handler entry SHALL still be recorded

#### Scenario: Intentional indefinite waiters are excluded

- **GIVEN** the channels `app:wait-until-ready`, which resolves only when startup completes, and `config:browse-directory`, which awaits a human dismissing a file dialog
- **WHEN** either exceeds the general threshold
- **THEN** no slow-handler entry SHALL be written for it

#### Scenario: A per-channel threshold suppresses reporting below it

- **GIVEN** `graviscan:reset-usb` has a per-channel threshold of 90000 ms
- **WHEN** it settles in 60000 ms
- **THEN** no slow-handler entry SHALL be written

#### Scenario: A per-channel threshold still reports above itself

- **GIVEN** `graviscan:reset-usb` has a per-channel threshold of 90000 ms
- **WHEN** it settles in 120000 ms
- **THEN** a slow-handler entry SHALL be recorded

#### Scenario: General threshold is configurable with a safe fallback

- **GIVEN** `BLOOM_DIAG_IPC_WARN_MS` is set to a valid positive number
- **WHEN** the watchdog is installed
- **THEN** that value SHALL be used as the general threshold
- **AND** an absent, non-numeric, zero, or negative value SHALL fall back to 3000 ms

### Requirement: In-Flight IPC Breadcrumbs

For a risk-listed set of channels — those that are operator-initiated or known to block — the watchdog SHALL write a start breadcrumb before invoking the handler and a matching end breadcrumb after it settles, so a block that never ends still leaves the responsible channel named on disk. The current risk list SHALL be maintained in the watchdog module.

Duration-based reporting cannot achieve this on its own: a handler that never settles is never reported, and a synchronous block delays the watchdog's own timers. The start breadcrumb SHALL be written before the first `await` in the wrapper, so its ordering guarantee holds.

Every breadcrumb SHALL carry a **per-invocation identifier**. Without one, two concurrent invocations of the same channel produce two starts and one end, and no reader can tell which is outstanding — which defeats the mechanism precisely when it matters. Concurrent invocation of a single channel is routine here; scan images are read per row from the renderer, and scanner detection has multiple independent call sites.

#### Scenario: A risk-listed channel writes start and end breadcrumbs

- **GIVEN** a channel is on the risk list
- **WHEN** it is invoked and settles
- **THEN** a start breadcrumb naming the channel and invocation identifier SHALL have been written before the handler ran
- **AND** a matching end breadcrumb with the elapsed duration in milliseconds SHALL be written after it settled

#### Scenario: An unfinished call leaves an unmatched start breadcrumb

- **GIVEN** a risk-listed channel is invoked and its handler never settles
- **WHEN** the diagnostics log is read
- **THEN** it SHALL contain that invocation's start breadcrumb with no matching end breadcrumb

#### Scenario: Concurrent invocations of one channel are individually attributable

- **GIVEN** a risk-listed channel is invoked twice concurrently
- **WHEN** both settle
- **THEN** each invocation SHALL have a distinct identifier
- **AND** each start breadcrumb SHALL be matched by the end breadcrumb bearing the same identifier

#### Scenario: One of two concurrent same-channel calls hanging is attributable

- **GIVEN** a risk-listed channel is invoked twice concurrently and only the first settles
- **WHEN** the diagnostics log is read
- **THEN** exactly one start breadcrumb SHALL be unmatched
- **AND** it SHALL be identifiable as the second invocation

#### Scenario: Non-risk-listed channels do not write breadcrumbs

- **GIVEN** a frequently polled channel that is not on the risk list
- **WHEN** it is invoked repeatedly
- **THEN** no breadcrumbs SHALL be written for it
- **AND** routine polling traffic SHALL NOT grow the diagnostics log

### Requirement: In-Flight IPC Registry

The watchdog SHALL maintain a registry of invocations currently in flight, keyed by invocation identifier rather than by channel, and SHALL expose it for dumping when a freeze indicator fires. Keying by channel would let the first of two concurrent same-channel calls remove the other's record, so a real freeze would report nothing in flight.

#### Scenario: Registry reports in-flight invocations with elapsed times

- **GIVEN** several instrumented handlers are in flight concurrently
- **WHEN** the registry is inspected
- **THEN** it SHALL report each in-flight invocation with its channel, identifier, and elapsed time in milliseconds

#### Scenario: Entries are removed on both settle paths

- **GIVEN** an instrumented handler is in flight
- **WHEN** it resolves, or rejects, or throws synchronously
- **THEN** its registry entry SHALL be removed

#### Scenario: Two concurrent calls on one channel are tracked separately

- **GIVEN** the same channel is invoked twice concurrently
- **WHEN** the first invocation settles
- **THEN** the registry SHALL still report the second invocation with its own elapsed time

#### Scenario: Registry is dumped through the synchronous path

- **GIVEN** a freeze indicator fires or the application is quitting
- **WHEN** the in-flight registry is dumped
- **THEN** it SHALL be written through the synchronous append path
- **AND** the dump SHALL contain channels, identifiers, and elapsed times only, never arguments

### Requirement: Breadcrumb Write Circuit Breaker

Breadcrumbs are written synchronously, so a degraded filesystem could make the instrument itself a source of the blocking it exists to diagnose. If synchronous diagnostics writes become slow or start failing, the breadcrumb path SHALL disable itself for the remainder of the run and record that it did so.

#### Scenario: A slow synchronous write disables breadcrumbs

- **GIVEN** a synchronous breadcrumb write exceeds its bound
- **WHEN** a subsequent risk-listed channel is invoked
- **THEN** no synchronous breadcrumb SHALL be attempted
- **AND** the disablement SHALL have been recorded

#### Scenario: Slow-call reporting continues after breadcrumbs are disabled

- **GIVEN** the breadcrumb path has disabled itself
- **WHEN** a handler exceeds its threshold
- **THEN** the slow-handler entry SHALL still be recorded through the ordinary path

#### Scenario: Disablement does not affect handler behaviour

- **GIVEN** the breadcrumb path has disabled itself
- **WHEN** any instrumented channel is invoked
- **THEN** its result SHALL be delivered unchanged
