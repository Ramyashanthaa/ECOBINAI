"""
Camera capture module.
In simulation mode: accepts uploaded image bytes directly (no physical camera needed).
In hardware mode: streams frames from OpenCV-connected camera.
"""

import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class CameraModule:
    def __init__(self, camera_index: int = 0, width: int = 640, height: int = 480):
        self._cap = None
        self._camera_index = camera_index
        self._width = width
        self._height = height

    def start(self) -> None:
        try:
            import cv2
            self._cap = cv2.VideoCapture(self._camera_index)
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._width)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._height)
            if not self._cap.isOpened():
                raise RuntimeError(f"Cannot open camera index {self._camera_index}")
            logger.info(f"Camera started: index={self._camera_index} {self._width}x{self._height}")
        except ImportError:
            logger.warning("OpenCV not available; camera capture disabled")
            self._cap = None

    def capture_jpeg(self) -> Optional[bytes]:
        """Capture one frame and return JPEG bytes."""
        if self._cap is None:
            return None
        import cv2
        ret, frame = self._cap.read()
        if not ret:
            logger.warning("Frame capture failed")
            return None
        _, buffer = cv2.imencode(".jpg", frame)
        return buffer.tobytes()

    def stop(self) -> None:
        if self._cap:
            self._cap.release()
            self._cap = None
            logger.info("Camera stopped")


def get_camera():
    from backend.config import settings
    return CameraModule(
        camera_index=settings.camera_index,
        width=settings.camera_resolution_w,
        height=settings.camera_resolution_h,
    )
