"""Test that all required dependencies can be imported."""
import pytest


def test_import_numpy():
    """Test that numpy can be imported and has correct version."""
    import numpy as np
    assert hasattr(np, '__version__')
    # Verify it's >= 1.26.0 per pyproject.toml
    major, minor, *_ = np.__version__.split('.')
    assert int(major) >= 1
    if int(major) == 1:
        assert int(minor) >= 26


def test_import_pypylon():
    """Test that pypylon can be imported."""
    try:
        import pypylon
        # If import succeeds, just verify the module loaded
        # pypylon has a complex structure and may not have __version__ at top level
        assert pypylon is not None
    except ImportError as e:
        pytest.skip(f"PyPylon not available: {e}")


def test_import_nidaqmx():
    """Test that nidaqmx can be imported and has version."""
    try:
        import nidaqmx
        assert hasattr(nidaqmx, '__version__')
    except ImportError as e:
        pytest.skip(f"NI-DAQmx not available: {e}")


def test_import_imageio():
    """Test that imageio can be imported."""
    import imageio
    assert hasattr(imageio, '__version__')


def test_package_version():
    """Test that package __init__ defines version."""
    import python
    assert hasattr(python, '__version__')
    assert python.__version__ == "0.1.0"
