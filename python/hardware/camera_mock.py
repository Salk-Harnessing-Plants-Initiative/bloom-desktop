"""
Mock camera implementation for testing without hardware.

Simulates a Basler camera by loading test images from disk.
Useful for development and testing without requiring actual camera hardware.
"""

import base64
import glob
from io import BytesIO
import os
import pathlib
import sys
import time
from typing import Dict, List, Any, Optional

import imageio.v2 as iio
import numpy as np
from PIL import Image

try:
    from .camera_types import CameraSettings
except ImportError:
    from camera_types import CameraSettings  # type: ignore[no-redef]


def _get_test_images_dir() -> pathlib.Path:
    """Get test images directory, handling both source and bundled execution.

    Returns:
        Path to test images directory. May not exist (triggers synthetic pattern fallback).
    """
    # Check if running from PyInstaller bundle
    if getattr(sys, "_MEIPASS", None):
        # Running from PyInstaller bundle
        # Try to find project root (for development builds in dist/)
        # Look for the project root by going up from the executable location
        if hasattr(sys, "executable"):
            exe_dir = pathlib.Path(sys.executable).parent
            # From dist/bloom-hardware -> project root
            project_root = exe_dir.parent
            test_images_path = project_root / "tests" / "fixtures" / "sample_scan"

            if test_images_path.exists():
                return test_images_path

        # Fallback: return non-existent path (will trigger synthetic patterns)
        return pathlib.Path("/nonexistent/test/images")
    else:
        # Running from source - use relative path from this file
        return (
            pathlib.Path(__file__).parent.parent.parent
            / "tests"
            / "fixtures"
            / "sample_scan"
        )


# Test images directory (relative to project root)
TEST_IMAGES_DIR = _get_test_images_dir()


class MockCamera:
    """Mock camera that simulates Basler camera behavior using test images."""

    def __init__(self, settings: CameraSettings):
        """Initialize the mock camera.

        Args:
            settings: Camera configuration settings
        """
        self.settings = settings
        self.is_open = False
        self.test_images = self._load_test_images()

    def _load_test_images(self) -> List[np.ndarray]:
        """Load test images from the test directory.

        Returns:
            List of image arrays

        Raises:
            FileNotFoundError: If test images directory doesn't exist
        """
        if not TEST_IMAGES_DIR.exists():
            # If no test images exist, generate simple test patterns
            print(
                f"WARNING: Test images directory not found at {TEST_IMAGES_DIR}",
                flush=True,
            )
            print("Generating synthetic test patterns instead", flush=True)
            return self._generate_test_patterns()

        image_files = glob.glob(str(TEST_IMAGES_DIR / "*.png"))

        # Validate that all image filenames have numeric stems before sorting
        for img_file in image_files:
            stem = pathlib.Path(img_file).stem
            if not stem.isdigit():
                raise ValueError(
                    f"Test image filename '{img_file}' does not have a numeric stem. "
                    "Filenames must be of the form '1.png', '2.png', etc."
                )

        image_files.sort(key=lambda x: int(pathlib.Path(x).stem))

        if not image_files:
            print(
                f"WARNING: No PNG files found in {TEST_IMAGES_DIR}",
                flush=True,
            )
            print("Generating synthetic test patterns instead", flush=True)
            return self._generate_test_patterns()

        images = []
        for img_file in image_files:
            try:
                images.append(iio.imread(img_file))
            except Exception as e:
                print(f"WARNING: Failed to load {img_file}: {e}", flush=True)

        # Type ignore needed: imageio.imread() has imprecise type hints that don't match np.ndarray
        return images if images else self._generate_test_patterns()  # type: ignore[return-value]

    def _generate_test_patterns(self, count: int = 72) -> List[np.ndarray]:
        """Generate synthetic test pattern images.

        Args:
            count: Number of test patterns to generate

        Returns:
            List of synthetic test pattern image arrays
        """
        patterns = []
        for i in range(count):
            # Create a simple gradient pattern with frame number
            img = np.zeros((480, 640), dtype=np.uint8)
            # Add gradient
            for y in range(480):
                img[y, :] = int(255 * y / 480)
            # Add frame number indicator (different brightness for each frame)
            brightness = int(255 * (i / count))
            img[200:280, 270:370] = brightness
            patterns.append(img)
        return patterns

    def open(self) -> bool:
        """Open the mock camera connection.

        Returns:
            True if successful
        """
        self.is_open = True
        print("STATUS:Mock camera opened", flush=True)
        return True

    def close(self) -> None:
        """Close the mock camera connection."""
        self.is_open = False
        print("STATUS:Mock camera closed", flush=True)

    def grab_frame(self) -> np.ndarray:
        """Grab a single frame from the mock camera.

        Returns:
            Image array

        Raises:
            RuntimeError: If camera is not open
        """
        if not self.is_open:
            raise RuntimeError("Camera is not open")

        # No artificial delay needed: real Basler camera trigger time is ~1-5ms (negligible)
        # For batch captures, grab_frames() adds realistic delays (0.1s per frame)

        # Cycle through available test images
        # Use a simple counter based on time to simulate different frames
        frame_idx = int(time.time() * 10) % len(self.test_images)
        return self.test_images[frame_idx].copy()

    def grab_frames(self, num_frames: Optional[int] = None) -> List[np.ndarray]:
        """Grab multiple frames from the mock camera.

        Args:
            num_frames: Number of frames to capture (defaults to settings.num_frames)

        Returns:
            List of image arrays

        Raises:
            RuntimeError: If camera is not open
        """
        if not self.is_open:
            raise RuntimeError("Camera is not open")

        if num_frames is None:
            num_frames = self.settings.num_frames

        # Ensure we don't exceed available test images
        num_frames = min(num_frames, len(self.test_images))

        frames = []
        for i in range(num_frames):
            print("TRIGGER_CAMERA", flush=True)
            time.sleep(0.1)  # Simulate capture delay
            frames.append(self.test_images[i].copy())

        return frames

    def grab_frame_base64(self) -> str:
        """Grab a single frame and return as base64-encoded PNG.

        This method is optimized for streaming use cases where frames need
        to be transmitted over IPC as base64 data URIs.

        Returns:
            Base64-encoded PNG string with data URI prefix
            Format: "data:image/png;base64,{encoded_data}"

        Raises:
            RuntimeError: If camera is not open or grab fails
        """
        img = self.grab_frame()

        # Convert numpy array to PIL Image and encode as PNG
        buffer = BytesIO()
        pil_img = Image.fromarray(img)
        pil_img.save(buffer, format="PNG", compress_level=0)
        base64_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        return f"data:image/png;base64,{base64_data}"

