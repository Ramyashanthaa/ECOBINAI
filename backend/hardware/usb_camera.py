"""
Headless USB-camera capture loop for the standalone Raspberry Pi 5 bin.

When `usb_camera_enabled = true` in settings, a background thread:
  1. Opens the USB webcam (cv2.VideoCapture(camera_index)).
  2. Polls frames every `usb_camera_interval_s`.
  3. Detects scene change via a 32×32 grayscale thumbnail comparison
     (mean absolute pixel diff > `usb_camera_scene_diff_threshold`).
  4. On meaningful change, encodes the frame as JPEG, runs `classify_waste`,
     and the classifier in turn drives the bin controller + DB write +
     WebSocket broadcast — exactly the same as a browser-uploaded frame.

The browser dashboard keeps working unchanged: lid-open events still flow
through the existing WebSocket broadcaster, so the UI shows the action in
real time even when the trigger came from the on-device camera.
"""

import logging
import threading
import time
from typing import Optional

import numpy as np

from backend.config import settings

logger = logging.getLogger(__name__)

_THUMB_SIZE = 32

# Single-flight guard so we don't queue overlapping classifications when
# inference takes longer than the polling interval.
_busy_lock = threading.Lock()
_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def _grab_thumbnail(frame) -> np.ndarray:
    import cv2
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (_THUMB_SIZE, _THUMB_SIZE), interpolation=cv2.INTER_AREA)


def _mean_abs_diff(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16))))


def _encode_jpeg(frame, quality: int = 90) -> bytes:
    import cv2
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("cv2.imencode failed")
    return buf.tobytes()


def _classify_and_actuate(image_bytes: bytes, controller) -> None:
    """Run the same pipeline a browser upload uses. Done in this thread."""
    import dataclasses
    from backend.classifier.waste_classifier import classify_waste
    from backend.database.models import SessionLocal
    from backend.hardware.simulator import _broadcast

    db = SessionLocal()
    try:
        result = classify_waste(image_bytes, controller=controller, db_session=db)
        logger.info(
            f"[USB-CAM] classified: {result.item_identified} → {result.category} "
            f"({result.confidence:.0%})"
        )
        # Push the full result to all connected browser dashboards so they can
        # update the result card and trigger the voice readout — the same
        # experience as an in-browser upload, but driven by the on-device camera.
        _broadcast({"type": "classification", "result": dataclasses.asdict(result)})
    except Exception as exc:
        logger.error(f"[USB-CAM] classification pipeline failed: {exc}", exc_info=True)
    finally:
        db.close()


def _capture_loop(controller) -> None:
    import cv2

    cam_idx = settings.camera_index
    # cv2 accepts int index or string device path
    try:
        cam_idx = int(cam_idx)
    except (TypeError, ValueError):
        pass

    cap = cv2.VideoCapture(cam_idx)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  settings.camera_resolution_w)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.camera_resolution_h)

    if not cap.isOpened():
        logger.error(f"[USB-CAM] could not open camera at index {cam_idx}")
        return

    logger.info(
        f"[USB-CAM] capture loop started (index={cam_idx}, "
        f"interval={settings.usb_camera_interval_s}s, "
        f"diff_threshold={settings.usb_camera_scene_diff_threshold})"
    )

    last_thumb: Optional[np.ndarray] = None

    try:
        while not _stop_event.is_set():
            ok, frame = cap.read()
            if not ok or frame is None:
                time.sleep(settings.usb_camera_interval_s)
                continue

            thumb = _grab_thumbnail(frame)
            # First frame: always run a baseline classification
            if last_thumb is None:
                changed = True
            else:
                changed = _mean_abs_diff(thumb, last_thumb) >= settings.usb_camera_scene_diff_threshold

            if changed and _busy_lock.acquire(blocking=False):
                last_thumb = thumb
                try:
                    img_bytes = _encode_jpeg(frame)
                    _classify_and_actuate(img_bytes, controller)
                finally:
                    _busy_lock.release()

            # Sleep in small slices so stop_event interrupts promptly
            slept = 0.0
            while slept < settings.usb_camera_interval_s and not _stop_event.is_set():
                time.sleep(0.1)
                slept += 0.1
    finally:
        cap.release()
        logger.info("[USB-CAM] capture loop stopped")


def start_capture_loop(controller) -> Optional[threading.Thread]:
    """Spawn the daemon capture thread. No-op if already running or disabled."""
    global _thread
    if not settings.usb_camera_enabled:
        logger.info("[USB-CAM] disabled (usb_camera_enabled=false)")
        return None
    if _thread and _thread.is_alive():
        logger.info("[USB-CAM] capture loop already running")
        return _thread
    _stop_event.clear()
    _thread = threading.Thread(target=_capture_loop, args=(controller,), daemon=True)
    _thread.start()
    return _thread


def stop_capture_loop(timeout: float = 2.0) -> None:
    _stop_event.set()
    if _thread:
        _thread.join(timeout=timeout)
