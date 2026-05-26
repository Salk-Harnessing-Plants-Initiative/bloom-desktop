"""Task 3.5 (#228): USBDEVFS_RESET removed from production recovery path.

These tests verify that _reopen_device() no longer calls
_reset_usb_device(), while preserving the rest of the recovery sequence
(device.cancel → device.close → sane.exit → sleep(3) → sane.init →
sane.open) and the existing 3-attempt retry-with-backoff.

Per investigation summary Section 1.2 and #228, the USBDEVFS_RESET ioctl
makes V600 wedges worse (controller FLR detaches the scanner entirely).
The _reset_usb_device method itself is preserved for testability.
"""

from unittest.mock import MagicMock, patch

import pytest

from python.graviscan.scan_worker import ScanWorker


def _make_worker(
    scanner_id="test-scanner", device_name="epkowa:interpreter:001:007", mock=False
):
    """Make a real-mode (not mock) worker so _reopen_device executes."""
    return ScanWorker(scanner_id=scanner_id, device_name=device_name, mock=mock)


# ── Tests ────────────────────────────────────────────────────────────────────


class TestReopenDeviceDoesNotCallResetUsbDevice:
    """_reopen_device() SHALL NOT invoke _reset_usb_device()."""

    def test_reopen_device_does_not_call_reset_usb_device(self):
        """Spy on _reset_usb_device; assert it is never called from
        _reopen_device on the happy path."""
        w = _make_worker()
        # Inject a mock sane module with init/open behaviour
        mock_sane = MagicMock()
        mock_sane.open.return_value = MagicMock()  # mock device
        w._sane = mock_sane

        with (
            patch.object(w, "_reset_usb_device") as mock_reset,
            patch("python.graviscan.scan_worker.time.sleep"),
        ):
            w._reopen_device()

        assert mock_reset.call_count == 0, (
            f"_reset_usb_device should not be called by _reopen_device "
            f"(was called {mock_reset.call_count} times)"
        )

    def test_reopen_device_does_not_call_reset_usb_device_on_retry(self):
        """Even when sane.open() fails on the first attempt and the
        retry-with-backoff kicks in, _reset_usb_device SHALL NOT be
        called."""
        w = _make_worker()
        mock_sane = MagicMock()
        # First call raises, second succeeds
        mock_sane.open.side_effect = [
            RuntimeError("sane open failed once"),
            MagicMock(),  # device on second try
        ]
        w._sane = mock_sane

        with (
            patch.object(w, "_reset_usb_device") as mock_reset,
            patch("python.graviscan.scan_worker.time.sleep"),
        ):
            w._reopen_device()

        assert mock_reset.call_count == 0


class TestReopenDeviceCallsSaneSequenceInOrder:
    """_reopen_device() SHALL still call device.cancel → device.close →
    sane.exit → sleep(3) → sane.init → sane.open in that order."""

    def test_full_recovery_sequence_in_order(self):
        """Track call order of the key recovery operations."""
        w = _make_worker()

        # Set up a mock previous device + sane
        mock_device = MagicMock()
        mock_new_device = MagicMock()
        w._device = mock_device
        mock_sane = MagicMock()
        mock_sane.open.return_value = mock_new_device
        w._sane = mock_sane

        # Single tracker to record call order across multiple mocks
        call_order = []

        def track(name):
            return lambda *args, **kwargs: call_order.append(name) or MagicMock()

        mock_device.cancel.side_effect = track("device.cancel")
        mock_device.close.side_effect = track("device.close")
        mock_sane.exit.side_effect = track("sane.exit")
        mock_sane.init.side_effect = track("sane.init")
        mock_sane.open.side_effect = lambda *args, **kwargs: (
            call_order.append("sane.open"),
            mock_new_device,
        )[1]

        with patch(
            "python.graviscan.scan_worker.time.sleep",
            side_effect=lambda s: call_order.append(f"sleep({s})") if s == 3 else None,
        ):
            w._reopen_device()

        # Filter to the recovery steps we care about
        recovery_steps = [
            c
            for c in call_order
            if c
            in {
                "device.cancel",
                "device.close",
                "sane.exit",
                "sleep(3)",
                "sane.init",
                "sane.open",
            }
        ]

        assert recovery_steps == [
            "device.cancel",
            "device.close",
            "sane.exit",
            "sleep(3)",
            "sane.init",
            "sane.open",
        ], f"unexpected order: {recovery_steps}"


class TestResetUsbDeviceMethodPreserved:
    """_reset_usb_device method MAY remain on the class for testability."""

    def test_method_is_still_importable(self):
        """The method SHALL still exist on the ScanWorker class so
        existing tests at test_scan_worker.py:364-385 continue to
        pass."""
        w = _make_worker(mock=True)
        assert hasattr(w, "_reset_usb_device")
        assert callable(getattr(w, "_reset_usb_device"))

    def test_method_does_not_raise_on_non_linux(self):
        """Calling _reset_usb_device directly on a non-Linux platform
        SHALL return early without raising (existing behavior)."""
        w = _make_worker(mock=True)
        # patch platform.system to return something non-Linux
        with patch("platform.system", return_value="Windows"):
            # Should be a no-op (no raise, no side effects we care about)
            w._reset_usb_device()


class TestNonWedgeTransientRecovery:
    """Non-wedge transient failures (e.g., SANE-busy) SHALL still recover
    via the standard sane.exit → sleep → sane.init → sane.open sequence
    without USBDEVFS_RESET."""

    def test_recovers_when_sane_open_succeeds_after_one_failure(self):
        """Mock sane.open to fail once then succeed; assert _reopen_device
        completes and the device attribute is set."""
        w = _make_worker()
        mock_sane = MagicMock()
        mock_new_device = MagicMock()
        mock_sane.open.side_effect = [
            RuntimeError("SANE busy"),
            mock_new_device,
        ]
        w._sane = mock_sane

        with (
            patch.object(w, "_reset_usb_device"),
            patch("python.graviscan.scan_worker.time.sleep"),
        ):
            w._reopen_device()

        # After recovery, device should be the new one returned by sane.open
        assert w._device is mock_new_device
        # sane.open was called twice (one fail, one success)
        assert mock_sane.open.call_count == 2

    def test_raises_after_three_open_failures(self):
        """The existing 3-attempt retry-with-backoff SHALL be preserved:
        if sane.open fails all 3 times, _reopen_device raises."""
        w = _make_worker()
        mock_sane = MagicMock()
        mock_sane.open.side_effect = RuntimeError("persistent failure")
        w._sane = mock_sane

        with (
            patch.object(w, "_reset_usb_device"),
            patch("python.graviscan.scan_worker.time.sleep"),
        ):
            with pytest.raises(RuntimeError, match="Failed to reopen device"):
                w._reopen_device()

        # 3 attempts before giving up
        assert mock_sane.open.call_count == 3
