"""Tests for main.py entry point and command loop."""
from unittest.mock import patch
import pytest

from python.main import main


def test_main_prints_header(capsys):
    """Test that main() prints the startup header."""
    # Simulate immediate exit
    with patch('builtins.input', side_effect=EOFError):
        main()

    captured = capsys.readouterr()
    assert "Bloom Hardware Interface" in captured.out
    assert "Python Version:" in captured.out
    assert "Platform:" in captured.out


def test_main_handles_exit_command(capsys):
    """Test that 'exit' command shuts down cleanly."""
    with patch('builtins.input', return_value='exit'):
        main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_quit_command(capsys):
    """Test that 'quit' command shuts down cleanly."""
    with patch('builtins.input', return_value='quit'):
        main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_help_command(capsys):
    """Test that 'help' command shows available commands."""
    with patch('builtins.input', side_effect=['help', 'exit']):
        main()

    captured = capsys.readouterr()
    assert "Available commands:" in captured.out


def test_main_handles_version_command(capsys):
    """Test that 'version' command shows Python version."""
    with patch('builtins.input', side_effect=['version', 'exit']):
        main()

    captured = capsys.readouterr()
    assert "Python" in captured.out


def test_main_handles_unknown_command(capsys):
    """Test that unknown commands show error message."""
    with patch('builtins.input', side_effect=['foobar', 'exit']):
        main()

    captured = capsys.readouterr()
    assert "Unknown command: foobar" in captured.out


def test_main_handles_keyboard_interrupt(capsys):
    """Test that Ctrl+C shuts down gracefully."""
    with patch('builtins.input', side_effect=KeyboardInterrupt):
        main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_handles_eof(capsys):
    """Test that EOF (Ctrl+D) shuts down gracefully."""
    with patch('builtins.input', side_effect=EOFError):
        main()

    captured = capsys.readouterr()
    assert "Shutting down..." in captured.out


def test_main_prints_import_status(capsys):
    """Test that import status is printed for dependencies."""
    with patch('builtins.input', side_effect=EOFError):
        main()

    captured = capsys.readouterr()
    # Should show status for all three dependencies
    assert "NumPy" in captured.out
    assert "PyPylon" in captured.out
    assert "NI-DAQmx" in captured.out
