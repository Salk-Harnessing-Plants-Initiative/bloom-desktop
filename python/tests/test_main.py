"""Tests for main.py entry point and command loop."""

import sys
from unittest.mock import MagicMock, patch

import pytest

from python.main import main


def test_main_prints_header(capsys):
    """Test that main() prints the startup header."""
    # Simulate immediate exit
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=EOFError):
            main()

    captured = capsys.readouterr()
    assert "Bloom Hardware Interface" in captured.out
    assert "Python Version:" in captured.out
    assert "Platform:" in captured.out


def test_main_handles_exit_command(capsys):
    """Test that 'exit' command shuts down cleanly."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", return_value="exit"):
            main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_quit_command(capsys):
    """Test that 'quit' command shuts down cleanly."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", return_value="quit"):
            main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_help_command(capsys):
    """Test that 'help' command shows available commands."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=["help", "exit"]):
            main()

    captured = capsys.readouterr()
    assert "Available commands:" in captured.out


def test_main_handles_version_command(capsys):
    """Test that 'version' command shows Python version."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=["version", "exit"]):
            main()

    captured = capsys.readouterr()
    assert "Python" in captured.out


def test_main_handles_unknown_command(capsys):
    """Test that unknown commands show error message."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=["foobar", "exit"]):
            main()

    captured = capsys.readouterr()
    assert "Unknown command: foobar" in captured.out


def test_main_handles_keyboard_interrupt(capsys):
    """Test that Ctrl+C shuts down gracefully."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=KeyboardInterrupt):
            main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_eof(capsys):
    """Test that EOF (Ctrl+D) shuts down gracefully."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=EOFError):
            main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_prints_import_status(capsys):
    """Test that import status is printed for dependencies."""
    with patch("sys.argv", ["bloom-hardware"]):
        with patch("builtins.input", side_effect=EOFError):
            main()

    captured = capsys.readouterr()
    # Should show status for all three dependencies
    assert "NumPy" in captured.out
    assert "PyPylon" in captured.out
    assert "NI-DAQmx" in captured.out


def test_main_scan_worker_mode_routing():
    """Test that --scan-worker routes to scan_worker_mode with correct args.

    Mocks run_worker (not scan_worker_mode) so scan_worker_mode's own import
    statement actually executes during the test — this exercises the `try`
    branch (dev-style `python.graviscan.scan_worker` import) only. See
    test_main_scan_worker_mode_import_fallback_executes below for a test that
    genuinely forces the `except ModuleNotFoundError` fallback branch.
    """
    argv = [
        "bloom-hardware",
        "--scan-worker",
        "--scanner-id",
        "test-uuid",
        "--device",
        "test-device",
    ]
    with patch("sys.argv", argv):
        with patch("python.graviscan.scan_worker.run_worker") as mock_run_worker:
            main()
            mock_run_worker.assert_called_once_with("test-uuid", "test-device", False)


def test_main_scan_worker_mode_with_mock():
    """Test that --scan-worker --mock passes mock=True to scan_worker_mode.

    Mocks run_worker (not scan_worker_mode) so scan_worker_mode's own import
    statement actually executes during the test — this exercises the `try`
    branch (dev-style `python.graviscan.scan_worker` import) only. See
    test_main_scan_worker_mode_import_fallback_executes below for a test that
    genuinely forces the `except ModuleNotFoundError` fallback branch.
    """
    argv = [
        "bloom-hardware",
        "--scan-worker",
        "--scanner-id",
        "test-uuid",
        "--device",
        "test-device",
        "--mock",
    ]
    with patch("sys.argv", argv):
        with patch("python.graviscan.scan_worker.run_worker") as mock_run_worker:
            main()
            mock_run_worker.assert_called_once_with("test-uuid", "test-device", True)


def test_main_scan_worker_mode_mock_without_device():
    """Test that --scan-worker --scanner-id X --mock (no --device) routes successfully.

    This is the packaged+mock subprocess contract used by
    src/main/graviscan/scanner-subprocess.ts: when GRAVISCAN_MOCK=true, the
    worker is spawned without --device. Validation must allow this and fall
    back to a non-empty device placeholder rather than calling parser.error.

    Mocks run_worker (not scan_worker_mode) so scan_worker_mode's own import
    statement actually executes during the test — this exercises the `try`
    branch (dev-style `python.graviscan.scan_worker` import) only. See
    test_main_scan_worker_mode_import_fallback_executes below for a test that
    genuinely forces the `except ModuleNotFoundError` fallback branch.
    """
    argv = [
        "bloom-hardware",
        "--scan-worker",
        "--scanner-id",
        "test-uuid",
        "--mock",
    ]
    with patch("sys.argv", argv):
        with patch("python.graviscan.scan_worker.run_worker") as mock_run_worker:
            main()
            mock_run_worker.assert_called_once_with("test-uuid", "mock-device", True)


def test_main_scan_worker_mode_import_fallback_executes():
    """Test that scan_worker_mode's `except ModuleNotFoundError` fallback import
    genuinely executes and reaches run_worker.

    Forces the primary `from python.graviscan.scan_worker import run_worker`
    to raise ModuleNotFoundError by setting its sys.modules entry to None
    (the documented way to make Python's import system raise
    ModuleNotFoundError for a specific module name), simulating the
    PyInstaller-bundled environment where the `python` package doesn't exist.
    The fallback `from graviscan.scan_worker import run_worker` then resolves
    against a fake `graviscan.scan_worker` module injected into sys.modules,
    so the except-branch import statement itself really runs (it is not
    skipped) and really succeeds, rather than only being claimed to run.
    """
    import types

    fake_module = types.ModuleType("graviscan.scan_worker")
    mock_run_worker = MagicMock()
    fake_module.run_worker = mock_run_worker

    argv = [
        "bloom-hardware",
        "--scan-worker",
        "--scanner-id",
        "test-uuid",
        "--device",
        "test-device",
    ]
    with patch("sys.argv", argv):
        with patch.dict(
            sys.modules,
            {
                "python.graviscan.scan_worker": None,
                "graviscan.scan_worker": fake_module,
            },
        ):
            main()

    mock_run_worker.assert_called_once_with("test-uuid", "test-device", False)


def test_main_scan_worker_mode_missing_scanner_id():
    """Test that --scan-worker without --scanner-id raises parser error."""
    with patch(
        "sys.argv", ["bloom-hardware", "--scan-worker", "--device", "test-device"]
    ):
        with pytest.raises(SystemExit):
            main()


def test_main_scan_worker_mode_missing_device():
    """Test that --scan-worker without --device raises parser error."""
    with patch(
        "sys.argv", ["bloom-hardware", "--scan-worker", "--scanner-id", "test-uuid"]
    ):
        with pytest.raises(SystemExit):
            main()


def test_main_scan_worker_and_ipc_mutually_exclusive():
    """Test that passing both --scan-worker and --ipc raises an argparse error.

    --scan-worker and --ipc are registered in a mutually_exclusive_group, so
    argparse itself rejects both being passed together (SystemExit) instead
    of main() silently prioritizing --scan-worker.
    """
    argv = [
        "bloom-hardware",
        "--scan-worker",
        "--ipc",
        "--scanner-id",
        "test-uuid",
        "--device",
        "test-device",
    ]
    with patch("sys.argv", argv):
        with pytest.raises(SystemExit):
            main()
