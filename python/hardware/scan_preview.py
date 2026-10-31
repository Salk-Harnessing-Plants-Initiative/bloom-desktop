"""A small picture of a scan's frame, for the page to show while the scan runs."""

import base64
from io import BytesIO

import numpy as np
from PIL import Image

PREVIEW_MAX_SIZE_PX = (800, 600)  # The size of the page's preview area
PREVIEW_JPEG_QUALITY = 60


def frame_preview_data_uri(image: np.ndarray) -> str:
    """Make a reduced JPEG data URI of a frame, leaving the frame itself unchanged.

    Args:
        image: The frame

    Returns:
        A data URI, as the live preview's frames are sent
    """
    with BytesIO() as buffer:
        with Image.fromarray(image) as pil_image:
            preview = pil_image.copy()
        preview.thumbnail(PREVIEW_MAX_SIZE_PX)
        preview.save(buffer, format="JPEG", quality=PREVIEW_JPEG_QUALITY)
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/jpeg;base64,{encoded}"
