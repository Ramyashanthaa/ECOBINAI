"""
Software simulator for bin lid hardware.
Broadcasts lid state changes via asyncio queues so the WebSocket endpoint
can push real-time events to the dashboard.
"""

import asyncio
import logging
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

VALID_BINS = {"RECYCLABLE", "COMPOST", "TRASH", "HAZARDOUS"}

_lid_states: dict[str, bool] = {b: False for b in VALID_BINS}
_last_event: Optional[dict] = None
_event_listeners: list[asyncio.Queue] = []

# The running event loop — captured once so background threads can schedule
# callbacks onto it safely via call_soon_threadsafe.
_loop: Optional[asyncio.AbstractEventLoop] = None


def capture_loop() -> None:
    """Call once from an async context (e.g. FastAPI lifespan) to store the loop."""
    global _loop
    _loop = asyncio.get_running_loop()


def get_lid_states() -> dict[str, bool]:
    return dict(_lid_states)


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _event_listeners.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _event_listeners.remove(q)
    except ValueError:
        pass


def _put_to_queue(q: asyncio.Queue, event: dict) -> None:
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        pass


def _broadcast(event: dict) -> None:
    """
    Thread-safe broadcast: if called from a background thread, schedule each
    queue.put_nowait onto the event loop via call_soon_threadsafe.
    """
    global _last_event
    _last_event = event

    if _loop is None or not _loop.is_running():
        # No event loop yet (e.g. during tests) — put directly
        for q in list(_event_listeners):
            _put_to_queue(q, event)
        return

    if threading.current_thread() is threading.main_thread():
        # Already on the event loop thread — put directly
        for q in list(_event_listeners):
            _put_to_queue(q, event)
    else:
        # Background thread — schedule safely onto the event loop
        for q in list(_event_listeners):
            _loop.call_soon_threadsafe(_put_to_queue, q, event)


class BinSimulator:
    """
    Drop-in replacement for the real BinController.
    Works in both sync and async contexts; auto-close runs in a daemon thread.
    """

    def open_lid(self, bin_type: str, duration: int = 5) -> None:
        if bin_type not in VALID_BINS:
            raise ValueError(f"Unknown bin type: {bin_type}")

        _lid_states[bin_type] = True
        _broadcast({"type": "lid_open", "bin": bin_type, "timestamp": time.time()})
        logger.info(f"[SIM] {bin_type} lid OPEN for {duration}s")

        def _auto_close():
            time.sleep(duration)
            self.close_lid(bin_type)

        threading.Thread(target=_auto_close, daemon=True).start()

    def close_lid(self, bin_type: str) -> None:
        _lid_states[bin_type] = False
        _broadcast({"type": "lid_close", "bin": bin_type, "timestamp": time.time()})
        logger.info(f"[SIM] {bin_type} lid CLOSED")

    def close_all(self) -> None:
        for bin_type in VALID_BINS:
            self.close_lid(bin_type)
