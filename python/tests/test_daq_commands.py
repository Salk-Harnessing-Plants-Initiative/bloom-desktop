"""Tests for DAQ IPC command handling."""

import json
import os
from io import StringIO

import pytest

from python.ipc_handler import (
    DAQ_AVAILABLE,
    cleanup_daq,
    get_daq_instance,
    handle_command,
    handle_daq_command,
)


# Test fixtures for DAQ settings
@pytest.fixture
def valid_daq_settings():
    """Valid DAQ settings for testing."""
    return {
        "device_name": "TestDAQ1",
        "sampling_rate": 40000,
        "step_pin": 0,
        "dir_pin": 1,
        "steps_per_revolution": 6400,
        "num_frames": 72,
        "seconds_per_rot": 36.0,
    }


@pytest.fixture
def minimal_daq_settings():
    """Minimal DAQ settings using defaults."""
    return {}  # Will use defaults from DAQSettings


@pytest.fixture(autouse=True)
def reset_daq_instance():
    """Reset the global DAQ instance before each test."""
    cleanup_daq()
    yield
    cleanup_daq()


@pytest.fixture(autouse=True)
def use_mock_daq(monkeypatch):
    """Force use of mock DAQ for all tests."""
    from python import ipc_handler

    monkeypatch.setattr(ipc_handler, "_use_mock_daq", True)


class TestDAQStatus:
    """Tests for DAQ status command."""

    def test_daq_status_not_initialized(self, monkeypatch, valid_daq_settings):
        """Test status when DAQ is not initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cmd = {"command": "daq", "action": "status"}
        handle_command(cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is False
        assert response["position"] == 0.0
        assert response["mock"] is True
        assert response["available"] == DAQ_AVAILABLE

    def test_daq_status_initialized(self, monkeypatch, valid_daq_settings):
        """Test status when DAQ is initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Check status
        status_cmd = {"command": "daq", "action": "status"}
        handle_command(status_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is True
        assert response["position"] == 0.0
        assert response["mock"] is True


class TestDAQInitialize:
    """Tests for DAQ initialize command."""

    def test_initialize_with_valid_settings(self, monkeypatch, valid_daq_settings):
        """Test initializing DAQ with valid settings."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is True

    def test_initialize_creates_daq_instance(self, valid_daq_settings):
        """Test that initialize creates a DAQ instance."""
        daq = get_daq_instance(valid_daq_settings)
        daq.initialize()

        assert daq is not None
        assert daq.is_initialized is True

    def test_initialize_with_defaults(self, monkeypatch):
        """Test initializing DAQ with default settings."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cmd = {"command": "daq", "action": "initialize", "settings": {}}
        handle_command(cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is True


class TestDAQCleanup:
    """Tests for DAQ cleanup command."""

    def test_cleanup_when_initialized(self, monkeypatch, valid_daq_settings):
        """Test cleanup when DAQ is initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Cleanup
        cleanup_cmd = {"command": "daq", "action": "cleanup"}
        handle_command(cleanup_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is False

    def test_cleanup_when_not_initialized(self, monkeypatch):
        """Test cleanup when DAQ is not initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cleanup_cmd = {"command": "daq", "action": "cleanup"}
        handle_command(cleanup_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["initialized"] is False

    def test_cleanup_clears_instance(self, valid_daq_settings):
        """Test that cleanup clears the DAQ instance."""
        # Create and initialize
        daq = get_daq_instance(valid_daq_settings)
        daq.initialize()

        # Cleanup
        cleanup_daq()

        # Try to create again - should create new instance
        daq2 = get_daq_instance(valid_daq_settings)
        assert daq2 is not None


class TestDAQRotate:
    """Tests for DAQ rotate command."""

    def test_rotate_when_initialized(self, monkeypatch, valid_daq_settings):
        """Test rotating when DAQ is initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Rotate
        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": 90.0}
        handle_command(rotate_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["position"] == 90.0

    def test_rotate_when_not_initialized(self, monkeypatch):
        """Test rotating when DAQ is not initialized fails."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": 90.0}
        handle_command(rotate_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is False
        assert "not initialized" in response["error"].lower()

    def test_rotate_without_degrees(self, monkeypatch, valid_daq_settings):
        """Test rotating without degrees parameter fails."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Rotate without degrees
        rotate_cmd = {"command": "daq", "action": "rotate"}
        handle_command(rotate_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is False
        assert "degrees parameter required" in response["error"]

    def test_rotate_negative_degrees(self, monkeypatch, valid_daq_settings):
        """Test rotating with negative degrees (counter-clockwise)."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Rotate counter-clockwise
        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": -45.0}
        handle_command(rotate_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["position"] == 315.0  # -45 wraps to 315


class TestDAQStep:
    """Tests for DAQ step command."""

    def test_step_when_initialized(self, monkeypatch, valid_daq_settings):
        """Test stepping when DAQ is initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Step
        step_cmd = {"command": "daq", "action": "step", "num_steps": 100, "direction": 1}
        handle_command(step_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["position"] > 0.0

    def test_step_when_not_initialized(self, monkeypatch):
        """Test stepping when DAQ is not initialized fails."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        step_cmd = {"command": "daq", "action": "step", "num_steps": 100}
        handle_command(step_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is False
        assert "not initialized" in response["error"].lower()

    def test_step_without_num_steps(self, monkeypatch, valid_daq_settings):
        """Test stepping without num_steps parameter fails."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Step without num_steps
        step_cmd = {"command": "daq", "action": "step"}
        handle_command(step_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is False
        assert "num_steps parameter required" in response["error"]

    def test_step_counter_clockwise(self, monkeypatch, valid_daq_settings):
        """Test stepping counter-clockwise."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Step counter-clockwise
        step_cmd = {
            "command": "daq",
            "action": "step",
            "num_steps": 100,
            "direction": -1,
        }
        handle_command(step_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        # Position should wrap around
        assert response["position"] > 350.0


class TestDAQHome:
    """Tests for DAQ home command."""

    def test_home_when_initialized(self, monkeypatch, valid_daq_settings):
        """Test homing when DAQ is initialized."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Initialize first
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Rotate away from home
        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": 180.0}
        handle_command(rotate_cmd)

        # Clear output
        output.truncate(0)
        output.seek(0)

        # Home
        home_cmd = {"command": "daq", "action": "home"}
        handle_command(home_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is True
        assert response["position"] == 0.0

    def test_home_when_not_initialized(self, monkeypatch):
        """Test homing when DAQ is not initialized fails."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        home_cmd = {"command": "daq", "action": "home"}
        handle_command(home_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])

        assert response["success"] is False
        assert "not initialized" in response["error"].lower()


class TestDAQErrorHandling:
    """Tests for DAQ error handling."""

    def test_unknown_daq_action(self, monkeypatch):
        """Test handling unknown DAQ action."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cmd = {"command": "daq", "action": "invalid_action"}
        handle_command(cmd)

        lines = output.getvalue().strip().split("\n")
        error_line = [l for l in lines if l.startswith("ERROR:")][0]

        assert "Unknown DAQ action" in error_line


class TestDAQWorkflow:
    """Tests for complete DAQ workflows."""

    def test_complete_workflow(self, monkeypatch, valid_daq_settings):
        """Test a complete DAQ workflow: initialize -> rotate -> home -> cleanup."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # 1. Initialize
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # 2. Rotate
        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": 90.0}
        handle_command(rotate_cmd)

        # 3. Home
        home_cmd = {"command": "daq", "action": "home"}
        handle_command(home_cmd)

        # 4. Cleanup
        cleanup_cmd = {"command": "daq", "action": "cleanup"}
        handle_command(cleanup_cmd)

        # Verify all succeeded
        lines = output.getvalue().strip().split("\n")
        data_lines = [l for l in lines if l.startswith("DATA:")]

        assert len(data_lines) == 4
        for line in data_lines:
            response = json.loads(line[5:])
            assert response["success"] is True

    def test_status_reflects_state_changes(self, monkeypatch, valid_daq_settings):
        """Test that status reflects DAQ state changes."""
        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        # Check initial status
        status_cmd = {"command": "daq", "action": "status"}
        handle_command(status_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])
        assert response["initialized"] is False

        # Initialize
        output.truncate(0)
        output.seek(0)
        init_cmd = {
            "command": "daq",
            "action": "initialize",
            "settings": valid_daq_settings,
        }
        handle_command(init_cmd)

        # Check status after init
        output.truncate(0)
        output.seek(0)
        handle_command(status_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])
        assert response["initialized"] is True
        assert response["position"] == 0.0

        # Rotate
        output.truncate(0)
        output.seek(0)
        rotate_cmd = {"command": "daq", "action": "rotate", "degrees": 45.0}
        handle_command(rotate_cmd)

        # Check status after rotate
        output.truncate(0)
        output.seek(0)
        handle_command(status_cmd)

        lines = output.getvalue().strip().split("\n")
        data_line = [l for l in lines if l.startswith("DATA:")][0]
        response = json.loads(data_line[5:])
        assert response["position"] == 45.0


class TestDAQUnavailable:
    """Tests for DAQ unavailable scenarios."""

    def test_daq_commands_when_unavailable(self, monkeypatch):
        """Test DAQ commands when DAQ module is unavailable."""
        # Mock DAQ as unavailable
        from python import ipc_handler

        original_available = ipc_handler.DAQ_AVAILABLE
        monkeypatch.setattr(ipc_handler, "DAQ_AVAILABLE", False)

        output = StringIO()
        monkeypatch.setattr("sys.stdout", output)

        cmd = {"command": "daq", "action": "status"}
        handle_command(cmd)

        lines = output.getvalue().strip().split("\n")
        error_line = [l for l in lines if l.startswith("ERROR:")][0]

        assert "DAQ module not available" in error_line

        # Restore
        monkeypatch.setattr(ipc_handler, "DAQ_AVAILABLE", original_available)