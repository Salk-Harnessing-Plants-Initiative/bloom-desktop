"""Shared, lock-protected stdout writer for the Bloom hardware IPC protocol.

`ipc_handler.py`'s main command-processing thread, the camera-streaming
background thread (`streaming_worker()`) and a scan's frame collector thread all
write line-delimited protocol messages to the same `sys.stdout`. A `FRAME:` line's base64 payload can be
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

from contextlib import contextmanager
import queue
import threading
from typing import Iterator, Optional

# How many lines can wait to be written before writes count as backed up.
BACKED_UP_LINES = 8

_stdout_lock = threading.Lock()
_background_lines: "Optional[queue.Queue[Optional[str]]]" = None


def _write_now(text: str) -> None:
    # Uses `with` (not manual acquire/release) so the lock is released even if
    # the underlying write raises (e.g. a `BrokenPipeError` from a dead parent
    # process) — otherwise a single failed write would deadlock every
    # subsequent protocol message.
    with _stdout_lock:
        print(text, flush=True)


def write_line(text: str) -> None:
    """Write one line to stdout, serialized against every other caller."""
    lines = _background_lines
    if lines is not None:
        lines.put(text)
    else:
        _write_now(text)


def _write_background_lines(lines: "queue.Queue[Optional[str]]") -> None:
    while (text := lines.get()) is not None:
        try:
            _write_now(text)
        except Exception:  # noqa: S110
            # The parent has gone: nothing can read this, and nothing should wait.
            pass


@contextmanager
def background_writes() -> Iterator[None]:
    """Make write_line never wait for the reader while this is active.

    For a scan's turn: if the parent is slow to read, stdout blocks, and that mustn't
    pause the turntable. Lines keep their order, and are all written on leaving this,
    which waits for them. Only the caller's thread may be writing at that moment.
    """
    global _background_lines
    lines: "queue.Queue[Optional[str]]" = queue.Queue()
    writer = threading.Thread(
        target=_write_background_lines,
        args=(lines,),
        name="stdout-background-writer",
        daemon=True,
    )
    writer.start()
    _background_lines = lines
    try:
        yield
    finally:
        _background_lines = None
        lines.put(None)
        writer.join()


def writes_backed_up() -> bool:
    """Whether background writes are waiting on a slow reader."""
    lines = _background_lines
    return lines is not None and lines.qsize() >= BACKED_UP_LINES
