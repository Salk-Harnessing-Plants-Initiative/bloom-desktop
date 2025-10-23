"""
Basler camera interface using PyPylon.

Provides real hardware control for Basler GigE cameras, including:
- Single frame capture
- Multi-frame capture
- Image streaming with base64 encoding
"""

import base64
import pathlib
import sys
import time
from io import BytesIO
from typing import Dict, List, Any, Optional

import imageio.v2 as iio
import numpy as np
from PIL import Image
from pypylon import pylon

try:
    from .camera_types import CameraSettings
except ImportError:
    from camera_types import CameraSettings  # type: ignore[no-redef]


class Camera:
    """Basler camera control using PyPylon."""

    def __init__(self, settings: CameraSettings):
        """Initialize the camera.

        Args:
            settings: Camera configuration settings
        """
        self.settings = settings
        self.camera: Optional[pylon.InstantCamera] = None
        self.is_open = False

    def open(self) -> bool:
        """Open connection to the Basler camera.

        Returns:
            True if successful

        Raises:
            RuntimeError: If camera cannot be opened
        """
        try:
            # Create transport layer factory
            tlf = pylon.TlFactory.GetInstance()

            # Create GigE transport layer
            tl = tlf.CreateTl("BaslerGigE")

            # Set camera IP address
            if self.settings.camera_ip_address is None:
                raise ValueError(
                    "Camera IP address must be provided for real camera connection"
                )
            cam_info = tl.CreateDeviceInfo()
            cam_info.SetIpAddress(self.settings.camera_ip_address)

            # Create and open camera
            self.camera = pylon.InstantCamera(tlf.CreateDevice(cam_info))
            self.camera.Open()

            # Configure camera settings
            self._configure_camera()

            self.is_open = True
            print(
                f"STATUS:Camera opened at {self.settings.camera_ip_address}", flush=True
            )
            return True

        except Exception as e:
            raise RuntimeError(f"Failed to open camera: {e}")

    def _configure_camera(self) -> None:
        """Configure camera parameters based on settings."""
        if not self.camera:
            return

        # Set exposure time
        self.camera.ExposureTimeAbs.Value = self.settings.exposure_time

        # Set gain
        self.camera.GainAuto.Value = "Off"
        self.camera.GainRaw.Value = self.settings.gain

        # Set gamma
        self.camera.GammaEnable.Value = True
        self.camera.GammaSelector.Value = "User"
        self.camera.Gamma.Value = self.settings.gamma

        # Note: Brightness and Contrast are not supported on all Basler cameras
        # (e.g., not available on aca2000-50gm)

    def close(self) -> None:
        """Close the camera connection."""
        if self.camera and self.is_open:
            try:
                if self.camera.IsGrabbing():
                    self.camera.StopGrabbing()
                self.camera.Close()
            finally:
                self.is_open = False
                print("STATUS:Camera closed", flush=True)

    def grab_frame(self) -> np.ndarray:
        """Grab a single frame from the camera.

        Returns:
            Image array

        Raises:
            RuntimeError: If camera is not open or grab fails
        """
        if not self.is_open or not self.camera:
            raise RuntimeError("Camera is not open")

        self.camera.StartGrabbingMax(1)

        try:
            grab_result = self.camera.RetrieveResult(
                5000, pylon.TimeoutHandling_ThrowException
            )

            if grab_result.GrabSucceeded():
                img = grab_result.Array.copy()
                grab_result.Release()
                return img  # type: ignore[return-value]
            else:
                grab_result.Release()
                raise RuntimeError("Frame grab failed")

        finally:
            if self.camera.IsGrabbing():
                self.camera.StopGrabbing()

    def grab_frames(self, num_frames: Optional[int] = None) -> List[np.ndarray]:
        """Grab multiple frames from the camera.

        Args:
            num_frames: Number of frames to capture (defaults to settings.num_frames)

        Returns:
            List of image arrays

        Raises:
            RuntimeError: If camera is not open or grab fails
        """
        if not self.is_open or not self.camera:
            raise RuntimeError("Camera is not open")

        if num_frames is None:
            num_frames = self.settings.num_frames

        self.camera.StartGrabbingMax(num_frames)

        frames = []
        try:
            while self.camera.IsGrabbing():
                grab_result = self.camera.RetrieveResult(
                    5000, pylon.TimeoutHandling_ThrowException
                )

                # Simulate stepper motor delay (placeholder for DAQ control)
                time.sleep(0.1)

                if grab_result.GrabSucceeded():
                    img = grab_result.Array.copy()
                    frames.append(img)

                grab_result.Release()

        finally:
            if self.camera.IsGrabbing():
                self.camera.StopGrabbing()

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
        base64_data = self._img_to_base64(img)
        return f"data:image/png;base64,{base64_data}"

    @staticmethod
    def _img_to_base64(img: np.ndarray) -> str:
        """Convert image array to base64-encoded PNG.

        Args:
            img: Image array

        Returns:
            Base64-encoded PNG string
        """
        buffer = BytesIO()
        pil_img = Image.fromarray(img)
        pil_img.save(buffer, format="PNG", compress_level=0)
        base64_img = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return base64_img


def run_camera_capture(output_dir: str, camera_settings: Dict[str, Any]) -> List[str]:
    """Run camera capture and save images.

    This is the main entry point for the camera capture script.

    Args:
        output_dir: Directory to save captured images
        camera_settings: Dictionary of camera settings

    Returns:
        List of output file paths
    """
    import os

    # Convert dict to CameraSettings object
    settings = CameraSettings(**camera_settings)

    output_path = pathlib.Path(output_dir)
    os.makedirs(output_path, exist_ok=True)

    # Create camera and capture frames
    camera = Camera(settings)
    camera.open()

    try:
        frames = camera.grab_frames(settings.num_frames)
    finally:
        camera.close()

    # Save frames
    output_files = []
    for i, frame in enumerate(frames):
        fname = output_path / f"{i + 1:03d}.png"
        iio.imwrite(str(fname), frame)
        output_files.append(str(fname))
        print(f"IMAGE_PATH {fname.name}", flush=True)

    return output_files


if __name__ == "__main__":
    import json

    if len(sys.argv) != 3:
        print("ERROR:Usage: camera.py <output_dir> <camera_settings_json>")
        sys.exit(1)

    output_dir = sys.argv[1]
    camera_settings = json.loads(sys.argv[2])

    try:
        output_files = run_camera_capture(output_dir, camera_settings)
        print(f"STATUS:Captured {len(output_files)} frames", flush=True)
    except Exception as e:
        print(f"ERROR:{str(e)}", flush=True)
        sys.exit(1)
