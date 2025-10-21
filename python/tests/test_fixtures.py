"""Tests for test fixture integrity."""
import pathlib
import pytest
from PIL import Image


def test_sample_scan_fixtures_exist():
    """Test that all 72 sample scan images exist."""
    fixtures_dir = (
        pathlib.Path(__file__).parent.parent.parent
        / "tests"
        / "fixtures"
        / "sample_scan"
    )

    assert fixtures_dir.exists(), f"Fixtures directory not found: {fixtures_dir}"

    # Check all 72 images exist
    for i in range(1, 73):
        image_path = fixtures_dir / f"{i}.png"
        assert image_path.exists(), f"Missing image: {i}.png"


def test_sample_scan_images_are_valid():
    """Test that sample scan images can be loaded and have expected dimensions."""
    fixtures_dir = (
        pathlib.Path(__file__).parent.parent.parent
        / "tests"
        / "fixtures"
        / "sample_scan"
    )

    # Test first, middle, and last images
    test_indices = [1, 36, 72]

    for i in test_indices:
        image_path = fixtures_dir / f"{i}.png"

        # Verify image can be opened
        with Image.open(image_path) as img:
            width, height = img.size

            # Real plant scans are 2048x1080
            assert width == 2048, f"Image {i}.png has wrong width: {width}"
            assert height == 1080, f"Image {i}.png has wrong height: {height}"

            # Verify it's a valid PNG
            assert img.format == "PNG", f"Image {i}.png is not PNG format"