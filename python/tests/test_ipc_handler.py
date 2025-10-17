"""Tests for IPC handler module."""
import json
import io
import sys
from unittest.mock import patch, MagicMock
import pytest

from python.ipc_handler import (
    send_status,
    send_error,
    send_data,
    check_hardware,
    handle_command,
)


def test_send_status(capsys):
    """Test that send_status outputs correct format."""
    send_status("test message")
    captured = capsys.readouterr()
    assert captured.out == "STATUS:test message\n"


def test_send_error(capsys):
    """Test that send_error outputs correct format."""
    send_error("test error")
    captured = capsys.readouterr()
    assert captured.out == "ERROR:test error\n"


def test_send_data(capsys):
    """Test that send_data outputs correct JSON format."""
    test_data = {"key": "value", "number": 42}
    send_data(test_data)
    captured = capsys.readouterr()
    assert captured.out.startswith("DATA:")

    # Parse JSON part
    json_str = captured.out[5:].strip()  # Remove "DATA:" prefix
    parsed = json.loads(json_str)
    assert parsed == test_data


def test_check_hardware():
    """Test that check_hardware returns status dict."""
    status = check_hardware()

    assert isinstance(status, dict)
    assert "camera" in status
    assert "daq" in status
    assert isinstance(status["camera"], bool)
    assert isinstance(status["daq"], bool)


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
    assert "Unknown command" in captured.out
