## ADDED Requirements

### Requirement: Packaged Linux Executable Naming

`forge.config.ts`'s `packagerConfig` SHALL set `executableName` so the staged Linux application binary is named `bloom-desktop` (sanitized, no space), via a small pure function (`resolveExecutableName(platform)`) rather than an inline platform check, so the platform-dependent naming logic is independently unit-testable. macOS and Windows SHALL continue to use the unmodified product name (`Bloom Desktop`), unchanged from their current, already-verified behavior.

#### Scenario: Linux executable is named without a space

- **WHEN** `electron-forge package`/`make` stages the application for `linux`
- **THEN** the staged binary is named `bloom-desktop`, matching what `tests/integration/lib/resolve-staged-app-path.ts`'s `linux` case resolves to, and what `@electron-forge/maker-deb`/`@electron-forge/maker-rpm` require to locate the binary

#### Scenario: macOS and Windows executable naming is unchanged

- **WHEN** `electron-forge package`/`make` stages the application for `darwin` or `win32`
- **THEN** the staged binary/bundle is named `Bloom Desktop`, exactly as before this requirement was added

## MODIFIED Requirements

### Requirement: Make-Based Packaging Artifact Verification

CI SHALL run the maker stage and verify that electron-forge produces installer artifacts, for each platform CI packages the app on. On Linux, the maker stage SHALL be scoped to only the maker(s) required for verification (`@electron-forge/maker-deb`), rather than running every maker configured for that platform.

#### Scenario: macOS maker artifacts produced

- **WHEN** the `test-make` CI job runs `npm run make` on `macos-latest`
- **THEN** at least one DMG or ZIP artifact exists under `out/make/` for the current platform/arch
- **AND** the artifact is non-trivially sized (not a zero-byte or truncated file from a crashed maker)
- **AND** the job fails if no such artifact is found

#### Scenario: Windows maker artifacts produced

- **WHEN** the `test-make-windows` CI job runs `npm run make` on `windows-latest`
- **THEN** at least one Squirrel installer artifact (`.exe` installer or `.nupkg`) exists under `out/make/` for the current platform/arch
- **AND** the artifact is non-trivially sized (not a zero-byte or truncated file from a crashed maker)
- **AND** the job fails if no such artifact is found

#### Scenario: Linux maker artifact produced

- **WHEN** the `test-make-linux` CI job runs `npm run make:linux` (which scopes electron-forge's maker stage to `@electron-forge/maker-deb` only) on `ubuntu-latest`
- **THEN** at least one `.deb` artifact exists under `out/make/` for the current platform/arch
- **AND** the artifact is non-trivially sized (not a zero-byte or truncated file from a crashed maker)
- **AND** the job fails if no such artifact is found
- **AND** a `.rpm` artifact is NOT required to exist for this scenario to pass

#### Scenario: Linux CI does not attempt to build the unrequired RPM maker

- **GIVEN** `forge.config.ts` configures both `@electron-forge/maker-deb` and `@electron-forge/maker-rpm` for Linux
- **WHEN** the `test-make-linux` CI job runs its maker stage
- **THEN** only `@electron-forge/maker-deb` is invoked
- **AND** a failure in `@electron-forge/maker-rpm` (were it to run) SHALL NOT be able to fail this job or prevent the `.deb` artifact from being produced, because that maker is never invoked in CI

#### Scenario: Verified maker artifacts are retained for manual download

- **WHEN** the `test-make`, `test-make-windows`, or `test-make-linux` CI job's artifact-verification step passes
- **THEN** the verified `out/make/` artifacts are uploaded as a downloadable CI build artifact, scoped per-OS, with a retention period long enough for a human to download and manually test-install (not the 1-day retention used for the transient Python-executable artifact)
- **AND** artifacts are NOT uploaded if the verification step fails (a known-broken maker output is never offered for download)

### Requirement: Make-Based Packaged App Launch Verification

CI SHALL apply the database schema externally (matching the app's production deployment model — the packaged app never runs migrations itself), then launch the packaged application binary staged by electron-forge's maker stage (prior to installation) and verify that a window actually renders and the app's own database connection and IPC handlers actually work, for each platform CI packages the app on. A database-initialization log line alone SHALL NOT be treated as sufficient evidence that the app launched successfully, nor SHALL it be relied upon at all — log lines emitted early in startup can race with other consumers of the process's stdout and are not a reliable signal. Checking only that the externally-seeded database file still exists and has the expected schema SHALL NOT be treated as sufficient evidence either — because the schema is seeded before launch, that file would look identical whether the app's own database initialization succeeded, failed, or never ran at all; a real IPC round-trip through the running app is required to prove the app's own database code path actually executed successfully. On Linux, where CI runs with no real desktop session, the launch SHALL run under a virtual display server with the Electron sandbox disabled.

#### Scenario: Window renders and the app's database IPC works on macOS

- **WHEN** the `test-make` CI job applies the database schema externally, then launches the staged app binary via Playwright's Electron driver
- **THEN** a window becomes available (`firstWindow()` resolves) within the configured timeout
- **AND** a read-only database IPC call made through the running app's renderer succeeds (proving `registerDatabaseHandlers()` ran and the database connection works)
- **AND** the expected database tables still exist in the database file after launch
- **AND** the job fails if any of these checks does not pass

#### Scenario: Window renders and the app's database IPC works on Windows

- **WHEN** the `test-make-windows` CI job applies the database schema externally, then launches the staged app binary via Playwright's Electron driver
- **THEN** a window becomes available (`firstWindow()` resolves) within the configured timeout
- **AND** a read-only database IPC call made through the running app's renderer succeeds (proving `registerDatabaseHandlers()` ran and the database connection works)
- **AND** the expected database tables still exist in the database file after launch
- **AND** the job fails if any of these checks does not pass

#### Scenario: Window renders and the app's database IPC works on Linux, under a virtual display with the sandbox disabled

- **WHEN** the `test-make-linux` CI job applies the database schema externally, then launches the staged app binary via Playwright's Electron driver under `xvfb-run` with `ELECTRON_DISABLE_SANDBOX=1` set
- **THEN** a window becomes available (`firstWindow()` resolves) within the configured timeout
- **AND** a read-only database IPC call made through the running app's renderer succeeds (proving `registerDatabaseHandlers()` ran and the database connection works)
- **AND** the expected database tables still exist in the database file after launch
- **AND** the job fails if any of these checks does not pass

#### Scenario: A broken database connection is detected, not masked by the pre-seeded file

- **GIVEN** the app's own database initialization fails after the schema has already been applied externally
- **WHEN** the verification runs
- **THEN** the read-only database IPC call fails (the handler is never registered, or the call resolves with a failure result)
- **AND** the job fails, even though the externally-seeded database file itself remains present and correctly structured

### Requirement: CI Job Timeout Bounds

The `build-python`, `test-integration`, `test-e2e-dev`, `test-make`, `test-make-windows`, and `test-make-linux` jobs in `pr-checks.yml` SHALL each declare an explicit `timeout-minutes` value, set with headroom above their observed typical duration. Because CI Concurrency Control queues `push`-to-`main` runs behind each other rather than running them in parallel, a hung job can now delay the start of a subsequently-queued `main` commit's entire CI run, not just its own — previously, independent parallel runs meant a hang only affected its own push. Without an explicit bound, that delay could extend up to GitHub's 6-hour per-job default. `build-python` is included because `test-integration`, `test-e2e-dev`, `test-make`, `test-make-windows`, and `test-make-linux` all declare `needs: build-python`: an unbounded hang there would prevent all five downstream jobs from ever starting, regardless of their own timeout values, defeating the point of bounding them at all.

#### Scenario: A hung job is terminated instead of blocking the queue indefinitely

- **GIVEN** a `test-e2e-dev` job hangs (for example, its background dev-server process never exits)
- **WHEN** the job's `timeout-minutes` value is reached
- **THEN** GitHub Actions terminates the job and marks the run as timed out
- **AND** a subsequent push to `main` queued behind it is no longer blocked by an indefinite hang once that run concludes (by timeout, rather than never)

#### Scenario: A hung upstream build cannot bypass the downstream jobs' bounds

- **GIVEN** `test-integration`, `test-e2e-dev`, `test-make`, `test-make-windows`, and `test-make-linux` all declare `needs: build-python`
- **WHEN** `build-python` hangs on a `push`-to-`main` run
- **THEN** `build-python`'s own `timeout-minutes` terminates it before GitHub's 6-hour default would otherwise apply
- **AND** none of the five downstream jobs are left waiting indefinitely on an upstream dependency that itself has no bound

#### Scenario: Timeout values leave headroom for normal runs

- **GIVEN** `build-python`, `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` have observed typical durations of roughly 1-2 minutes, 2-4 minutes, 24-34 minutes (with a real non-hung outlier at 46 minutes), 4-6 minutes, and 11 minutes respectively (see `design.md` for the underlying data and its caveats), and `test-make-linux` has no observed CI duration yet at the time this requirement was written
- **WHEN** each job runs normally
- **THEN** its configured `timeout-minutes` (10, 15, 90, 20, 30, and 20 respectively) is above the observed range for the five jobs with observed data, including the worst real data point found for `test-e2e-dev`
- **AND** `test-make-linux`'s value is treated as a provisional estimate pending its own observed data, not an equally well-founded figure
- **AND** a normal run is never falsely terminated for running long

#### Scenario: Timeout values are enforced by the same regression test

- **GIVEN** a developer edits `.github/workflows/pr-checks.yml`
- **WHEN** the edit removes the `timeout-minutes` key from any of the six affected jobs, or adds one to a job outside this set
- **THEN** `tests/unit/pr-checks-workflow.test.ts` fails, surfacing the regression before it reaches CI
