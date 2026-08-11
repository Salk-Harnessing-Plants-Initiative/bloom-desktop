"""Shared, lock-protected stdout writer for the Bloom hardware IPC protocol.

`ipc_handler.py`'s main command-processing thread and the camera-streaming
background thread (`streaming_worker()`) both write line-delimited protocol
messages to the same `sys.stdout`. A `FRAME:` line's base64 payload can be
large enough to need multiple OS write() syscalls to flush, and CPython
releases the GIL during each one — so, unsynchronized, a second thread's
write can land in the gap between two of those syscalls and corrupt the
line-delimited protocol (#316). `write_line()` is the single point every
stdout writer reachable while a camera stream may be active must go through,
so no two writes can ever interleave.

Deliberately dependency-free (only `threading`): every other module that
needs this (`ipc_handler.py`, `hardware/*.py`) imports from here, and this
module must never import from them, to avoid circular imports.
"""

import threading

_stdout_lock = threading.Lock()


def write_line(text: str) -> None:
    """Write one line to stdout, serialized against every other caller.

    Uses `with` (not manual acquire/release) so the lock is released even if
    the underlying write raises (e.g. a `BrokenPipeError` from a dead parent
    process) — otherwise a single failed write would deadlock every
    subsequent protocol message.
    """
    with _stdout_lock:
        print(text, flush=True)
