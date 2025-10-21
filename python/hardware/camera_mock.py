"""
Mock camera implementation for testing without hardware.

Simulates a Basler camera by loading test images from disk.
Useful for development and testing without requiring actual camera hardware.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
import glob
import os
import pathlib
import sys
import time
from typing import Dict, List, Any, Optional

import imageio.v2 as iio
import numpy as np

try:
    from .camera_types import CameraSettings
except ImportError:
    from camera_types import CameraSettings  # type: ignore[no-redef]


# Test images directory (relative to project root)
# TODO: Create test/sample_scan directory with test images
TEST_IMAGES_DIR = pathlib.Path(__file__).parent.parent.parent / "test" / "sample_scan"


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

        # Simulate camera trigger delay
        time.sleep(0.1)

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


async def save_image_async(
    executor: ThreadPoolExecutor, output_path: pathlib.Path, idx: int, array: np.ndarray
) -> None:
    """Asynchronously save an image to disk.

    Args:
        executor: Thread pool executor
        output_path: Output file path
        idx: Frame index
        array: Image array to save
    """
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(executor, iio.imwrite, str(output_path), array)


async def parallel_imwrite(
    images: List[np.ndarray], output_dir: pathlib.Path
) -> List[str]:
    """Write multiple images to disk in parallel.

    Args:
        images: List of image arrays
        output_dir: Output directory path

    Returns:
        List of output file paths
    """
    image_paths = [f"{idx + 1:03d}.png" for idx in range(len(images))]
    output_paths = [output_dir / image_path for image_path in image_paths]

    # Create a ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as executor:
        # Schedule all the save operations to run asynchronously
        tasks = [
            save_image_async(executor, output_paths[idx], idx, array)
            for idx, array in enumerate(images)
        ]
        # Wait for all scheduled tasks to complete
        await asyncio.gather(*tasks)

    # Print image paths after saving
    for image_path in image_paths:
        print(f"IMAGE_PATH {image_path}", flush=True)
        time.sleep(0.01)

    return [str(p) for p in output_paths]


def run_mock_camera_capture(
    output_dir: str, camera_settings: Dict[str, Any]
) -> List[str]:
    """Run mock camera capture and save images.

    This is the main entry point for the mock camera script.

    Args:
        output_dir: Directory to save captured images
        camera_settings: Dictionary of camera settings

    Returns:
        List of output file paths
    """
    # Convert dict to CameraSettings object
    settings = CameraSettings(**camera_settings)

    output_path = pathlib.Path(output_dir)
    os.makedirs(output_path, exist_ok=True)

    # Create mock camera and capture frames
    camera = MockCamera(settings)
    camera.open()

    try:
        frames = camera.grab_frames(settings.num_frames)
    finally:
        camera.close()

    # Save frames in parallel
    output_files = asyncio.run(parallel_imwrite(frames, output_path))

    return output_files


if __name__ == "__main__":
    import json

    if len(sys.argv) != 3:
        print("ERROR:Usage: camera_mock.py <output_dir> <camera_settings_json>")
        sys.exit(1)

    output_dir = sys.argv[1]
    camera_settings = json.loads(sys.argv[2])

    try:
        output_files = run_mock_camera_capture(output_dir, camera_settings)
        print(f"STATUS:Captured {len(output_files)} frames", flush=True)
    except Exception as e:
        print(f"ERROR:{str(e)}", flush=True)
        sys.exit(1)
