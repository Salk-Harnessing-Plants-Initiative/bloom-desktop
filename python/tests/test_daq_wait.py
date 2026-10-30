"""Waiting for a move: "not done yet" arrives from NI-DAQmx as an error."""

from unittest.mock import MagicMock

import numpy as np
import pytest

from python.hardware.daq import DAQ, DAQ_RETRY_MAX_ATTEMPTS
from python.hardware.daq_types import DAQSettings

NOT_DONE_YET = Exception("Wait Until Done did not indicate done (-200560)")
DATA = np.zeros((2, 8), dtype=bool)


def make_daq(wait_until_done):
    daq = DAQ(DAQSettings())
    daq.task = MagicMock()
    daq.task.wait_until_done.side_effect = wait_until_done
    return daq


def test_keeps_waiting_while_the_move_is_running():
    daq = make_daq([NOT_DONE_YET] * 15 + [None])

    daq._write_and_execute(DATA)

    assert daq.task.wait_until_done.call_count == 16
    daq.task.stop.assert_called_once()


@pytest.mark.parametrize("code", [-200560, -200563, -50103])
def test_retries_whatever_the_error_code(code):
    error = Exception(f"DAQ error {code}")
    error.error_code = code
    daq = make_daq([error, None])

    daq._write_and_execute(DATA)

    assert daq.task.wait_until_done.call_count == 2


def test_gives_up_in_the_end_and_says_why():
    daq = make_daq(NOT_DONE_YET)

    with pytest.raises(RuntimeError, match="did not complete.*-200560"):
        daq._write_and_execute(DATA)

    assert daq.task.wait_until_done.call_count == DAQ_RETRY_MAX_ATTEMPTS
    daq.task.stop.assert_called_once()
