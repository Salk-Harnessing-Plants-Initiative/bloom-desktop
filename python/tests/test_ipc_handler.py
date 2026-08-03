"""Tests for IPC handler module."""

import json

import pytest

from python import ipc_handler
from python.ipc_handler import (
    send_status,
    send_error,
    send_data,
    check_hardware,
    handle_command,
)


@pytest.fixture(autouse=True)
def reset_current_request_id():
    """Reset the module-level request-id state before/after every test.

    Prevents cross-test leakage: send_data()/send_error() read this global
    directly (not passed as a parameter), so a test that doesn't go
    through handle_command() (which always resets it) could otherwise pick
    up stale state left by an earlier test.
    """
    ipc_handler._current_request_id = None
    yield
    ipc_handler._current_request_id = None


def test_send_status(capsys):
    """Test that send_status outputs correct format."""
    send_status("test message")
    captured = capsys.readouterr()
    assert captured.out == "STATUS:test message\n"


def test_send_error(capsys):
    """Test that send_error outputs a JSON envelope with no id when unset."""
    send_error("test error")
    captured = capsys.readouterr()
    assert captured.out.startswith("ERROR:")
    payload = json.loads(captured.out[len("ERROR:") :].strip())
    assert payload == {"message": "test error"}


def test_send_error_includes_id_when_current_request_id_set(capsys):
    """send_error(tag_request=True) (default) includes the current id."""
    ipc_handler._current_request_id = 5
    send_error("test error")
    captured = capsys.readouterr()
    payload = json.loads(captured.out[len("ERROR:") :].strip())
    assert payload == {"message": "test error", "id": 5}


def test_send_error_tag_request_false_never_includes_id(capsys):
    """send_error(tag_request=False) omits the id even if one is set.

    This is the fix for the streaming-thread bug: streaming_worker() runs
    on a background thread and must never attribute its own async errors
    to whatever command happens to be in flight on the main thread.
    """
    ipc_handler._current_request_id = 5
    send_error("streaming error", tag_request=False)
    captured = capsys.readouterr()
    payload = json.loads(captured.out[len("ERROR:") :].strip())
    assert payload == {"message": "streaming error"}


def test_send_data(capsys):
    """Test that send_data outputs correct JSON format.

    No id is added when _current_request_id is unset — confirmed by the
    full dict-equality assertion below, which would fail if send_data
    ever added an "id": None key instead of omitting it entirely.
    """
    test_data = {"key": "value", "number": 42}
    send_data(test_data)
    captured = capsys.readouterr()
    assert captured.out.startswith("DATA:")

    # Parse JSON part
    json_str = captured.out[5:].strip()  # Remove "DATA:" prefix
    parsed = json.loads(json_str)
    assert parsed == test_data


def test_send_data_includes_id_when_current_request_id_set(capsys):
    """send_data() merges in the current request id when one is set."""
    ipc_handler._current_request_id = 7
    send_data({"key": "value"})
    captured = capsys.readouterr()
    parsed = json.loads(captured.out[5:].strip())
    assert parsed == {"key": "value", "id": 7}


def test_check_hardware():
    """Test that check_hardware returns detailed status dict."""
    status = check_hardware()

    assert isinstance(status, dict)
    assert "camera" in status
    assert "daq" in status

    # Check camera status structure
    assert isinstance(status["camera"], dict)
    assert "library_available" in status["camera"]
    assert "devices_found" in status["camera"]
    assert "available" in status["camera"]
    assert isinstance(status["camera"]["library_available"], bool)
    assert isinstance(status["camera"]["devices_found"], int)
    assert isinstance(status["camera"]["available"], bool)

    # Check DAQ status structure
    assert isinstance(status["daq"], dict)
    assert "library_available" in status["daq"]
    assert "devices_found" in status["daq"]
    assert "available" in status["daq"]
    assert isinstance(status["daq"]["library_available"], bool)
    assert isinstance(status["daq"]["devices_found"], int)
    assert isinstance(status["daq"]["available"], bool)


def test_handle_command_ping(capsys):
    """Test ping command."""
    handle_command({"command": "ping"})
    captured = capsys.readouterr()

    assert captured.out.startswith("DATA:")
    json_str = captured.out[5:].strip()
    data = json.loads(json_str)
    assert data["status"] == "ok"
    assert data["message"] == "pong"


def test_handle_command_get_version(capsys):
    """Test get_version command."""
    handle_command({"command": "get_version"})
    captured = capsys.readouterr()

    assert captured.out.startswith("DATA:")
    json_str = captured.out[5:].strip()
    data = json.loads(json_str)
    assert "version" in data
    assert data["version"] == "0.1.0"


def test_handle_command_check_hardware(capsys):
    """Test check_hardware command."""
    handle_command({"command": "check_hardware"})
    captured = capsys.readouterr()

    assert captured.out.startswith("DATA:")
    json_str = captured.out[5:].strip()
    data = json.loads(json_str)
    assert "camera" in data
    assert "daq" in data


def test_handle_command_unknown(capsys):
    """Test unknown command."""
    handle_command({"command": "unknown_cmd"})
    captured = capsys.readouterr()

    assert captured.out.startswith("ERROR:")
    assert "Unknown command" in captured.out


def test_handle_command_missing_command_key(capsys):
    """Test command with missing 'command' key."""
    handle_command({})
    captured = capsys.readouterr()

    assert captured.out.startswith("ERROR:")
    payload = json.loads(captured.out[len("ERROR:") :].strip())
    assert "Unknown command" in payload["message"]


def test_handle_command_threads_id_into_response(capsys):
    """handle_command() sets _current_request_id from cmd['id'] and the
    response echoes it back, then resets to None once the command
    completes — so it never leaks into a later, unrelated command."""
    handle_command({"command": "ping", "id": 42})
    captured = capsys.readouterr()

    payload = json.loads(captured.out[len("DATA:") :].strip())
    assert payload["id"] == 42
    assert ipc_handler._current_request_id is None


def test_handle_command_with_no_id_omits_id_from_response(capsys):
    """A command sent with no 'id' key produces a response with no id."""
    handle_command({"command": "ping"})
    captured = capsys.readouterr()

    payload = json.loads(captured.out[len("DATA:") :].strip())
    assert "id" not in payload
