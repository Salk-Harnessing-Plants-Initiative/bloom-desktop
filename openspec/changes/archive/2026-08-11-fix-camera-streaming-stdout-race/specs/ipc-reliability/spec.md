## ADDED Requirements

### Requirement: Synchronized Stdout Protocol Writes

Every stdout write reachable from within the shared `ipc_handler.py` process — the main command thread's protocol responses (`send_status`, `send_error`, `send_data`) and any diagnostic output from `detect_cameras()` or the `hardware/*.py` camera/DAQ modules, in addition to the camera-streaming background thread's `send_frame` calls — SHALL be serialized through a single shared lock (`protocol_io.write_line()`), so that no two writers can ever interleave at the byte level, regardless of how many underlying OS write syscalls a single message requires.

#### Scenario: A command response never interleaves with an in-flight frame write

- **GIVEN** the streaming background thread is in the middle of writing a `FRAME:` line whose payload requires multiple underlying OS write syscalls to flush
- **WHEN** the main thread concurrently calls `send_data()` (e.g. to respond to `start_stream` or `stop_stream`) or `send_error()`
- **THEN** the main thread's write SHALL NOT begin until the in-flight `FRAME:` write has fully completed
- **AND** the resulting stdout byte stream SHALL contain both messages as complete, independently newline-terminated lines, in either order, never merged into one corrupted line

#### Scenario: A hardware-module diagnostic line never interleaves with an in-flight frame write

- **GIVEN** the streaming background thread is in the middle of writing a `FRAME:` line
- **WHEN** the main thread concurrently triggers a diagnostic or status print from `python/hardware/camera.py`, `camera_mock.py`, `daq.py`, `daq_mock.py`, `scanner.py`, or `ipc_handler.py`'s `detect_cameras()` (e.g. reconnecting the camera while a previous stream is still active, or a DAQ cleanup warning)
- **THEN** that write SHALL go through the same shared serialization as the `send_*` helpers
- **AND** it SHALL NOT interleave with the in-flight `FRAME:` write

#### Scenario: The stdout lock is distinct from the streaming-state lock

- **GIVEN** `stop_stream` holds `_streaming_lock` while blocked in `_streaming_thread.join(timeout=2.0)`, waiting for the streaming thread to observe `_streaming_active.clear()` and exit
- **AND** the streaming thread is attempting to write its last in-flight frame before it can observe that flag and exit
- **WHEN** the streaming thread acquires the stdout lock to complete that write
- **THEN** it SHALL NOT be blocked by `_streaming_lock` (a different lock), so it can complete its write and exit within the join timeout
- **AND** `stop_stream` SHALL return a response reflecting the thread's actual stopped state, not time out waiting for a thread that cannot make progress

#### Scenario: The stdout lock releases even when the underlying write fails

- **GIVEN** a caller is writing a line via the shared serialization primitive
- **WHEN** the underlying stdout write raises an exception (e.g. a `BrokenPipeError` because the parent process has exited)
- **THEN** the lock SHALL still be released
- **AND** a subsequent, unrelated write from another thread SHALL NOT be blocked or deadlocked by the failed write
