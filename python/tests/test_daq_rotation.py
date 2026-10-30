"""One scan must turn the plant exactly one full turn.

Counts the step pulses the real DAQ class sends to the motor, with the hardware
write replaced.
"""

import numpy as np
import pytest

from python.hardware.daq import DAQ
from python.hardware.daq_types import STEPS_PER_TURNTABLE_REV, DAQSettings


def make_daq(**settings):
    daq = DAQ(DAQSettings(**settings))
    daq.is_initialized = True
    daq.task = object()
    daq.pulses = []
    daq.bursts = []

    def record(data):
        step_channel = data[0]
        rising_edges = int(np.sum(step_channel[1:] & ~step_channel[:-1]))
        direction = 1 if data[1][0] else -1
        daq.pulses.append(rising_edges * direction)
        daq.bursts.append(data)

    daq._write_and_execute = record
    return daq


def test_a_turn_of_the_turntable_goes_through_the_gears():
    # 20,000 microsteps per motor turn, 60/42 gears: the pilot app's numbers.
    assert STEPS_PER_TURNTABLE_REV == 28571
    assert DAQSettings().steps_per_revolution == 28571


@pytest.mark.parametrize("num_frames", [72, 36, 7, 100])
def test_a_scan_is_exactly_one_full_turn(num_frames):
    daq = make_daq(num_frames=num_frames)

    for _ in range(num_frames):
        daq.rotate(360.0 / num_frames)

    assert sum(daq.pulses) == STEPS_PER_TURNTABLE_REV


def test_frames_are_evenly_spaced_to_within_one_step():
    daq = make_daq()

    for _ in range(72):
        daq.rotate(5.0)

    assert set(daq.pulses) == {396, 397}


def test_after_a_full_turn_homing_does_not_move_and_the_next_scan_is_a_full_turn():
    daq = make_daq()
    for _ in range(72):
        daq.rotate(5.0)
    moved = len(daq.pulses)

    daq.home()
    assert len(daq.pulses) == moved

    daq.pulses.clear()
    for _ in range(72):
        daq.rotate(5.0)
    assert sum(daq.pulses) == STEPS_PER_TURNTABLE_REV


def test_an_interrupted_scan_homes_back_to_where_it_started():
    daq = make_daq()
    for _ in range(9):
        daq.rotate(5.0)

    daq.home()

    assert sum(daq.pulses) == 0
    assert daq.get_position() == 0.0


def test_the_motor_speed_follows_seconds_per_rot():
    def pulse_rate(seconds_per_rot):
        daq = make_daq(seconds_per_rot=seconds_per_rot)
        daq.rotate(5.0)
        samples = daq.bursts[0].shape[1]
        return daq.pulses[0] / (samples / daq.settings.sampling_rate)

    # 7 seconds per turn gives the pilot app's 5 kHz at its 40 kHz sampling rate.
    assert pulse_rate(7.0) == pytest.approx(5000)
    assert pulse_rate(36.0) == pytest.approx(800, rel=0.02)
