"""Waiting for a move: "not done yet" arrives from NI-DAQmx as an error."""

from unittest.mock import MagicMock

import numpy as np
import pytest

from python.hardware import daq as daq_module
from python.hardware.daq import DAQ, DAQ_WAIT_MARGIN_S
from python.hardware.daq_types import DAQSettings

NOT_DONE_YET = Exception("Wait Until Done did not indicate done (-200560)")
SAMPLING_RATE = 40000


def samples_for(seconds):
    return np.zeros((2, int(seconds * SAMPLING_RATE)), dtype=bool)


class FakeClock:
    """Time that only passes when the code waits."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr(daq_module, "time", fake)
    return fake


def make_daq(clock, move_takes_s=None, **settings):
    """A DAQ whose task finishes after move_takes_s, or never if None."""
    daq = DAQ(DAQSettings(sampling_rate=SAMPLING_RATE, **settings))
    daq.is_initialized = True

    def wait_until_done(timeout):
        clock.now += timeout
        if move_takes_s is None or clock.now < move_takes_s:
            raise NOT_DONE_YET

    daq.task = MagicMock()
    daq.task.wait_until_done.side_effect = wait_until_done
    return daq


def test_keeps_waiting_while_the_move_is_running(clock):
    daq = make_daq(clock, move_takes_s=0.08)

    daq._write_and_execute(samples_for(0.08))

    assert daq.task.wait_until_done.call_count > 1
    daq.task.stop.assert_called_once()


@pytest.mark.parametrize("code", [-200560, -200563, -50103])
def test_retries_whatever_the_error_code(clock, code):
    error = Exception(f"DAQ error {code}")
    error.error_code = code
    daq = make_daq(clock)
    daq.task.wait_until_done.side_effect = [error, None]

    daq._write_and_execute(samples_for(0.08))

    assert daq.task.wait_until_done.call_count == 2


def test_a_slow_move_has_as_long_as_it_needs(clock):
    # 120 s per turn with one frame: the slowest move the settings allow.
    daq = make_daq(clock, move_takes_s=120)

    daq._write_and_execute(samples_for(120))

    daq.task.stop.assert_called_once()


def test_homing_a_half_turn_at_a_slow_setting_finishes(clock):
    daq = make_daq(clock, move_takes_s=18, seconds_per_rot=36)
    daq.current_position = 180.0
    daq._moved_degrees = 180.0

    daq.home()

    assert daq.current_position == 0.0


def test_gives_up_soon_after_the_move_should_have_ended_and_says_why(clock):
    daq = make_daq(clock)

    with pytest.raises(RuntimeError, match="did not complete.*-200560"):
        daq._write_and_execute(samples_for(10))

    assert clock.now == pytest.approx(10 + DAQ_WAIT_MARGIN_S, abs=0.1)
    daq.task.stop.assert_called_once()


def test_an_error_that_returns_at_once_does_not_spin(clock):
    daq = make_daq(clock)
    daq.task.wait_until_done.side_effect = NOT_DONE_YET

    with pytest.raises(RuntimeError, match="did not complete"):
        daq._write_and_execute(samples_for(0))

    assert clock.now == pytest.approx(DAQ_WAIT_MARGIN_S, abs=0.1)
