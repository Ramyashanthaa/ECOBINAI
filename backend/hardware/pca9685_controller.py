"""
PCA9685-backed bin controller — drives 4 SG90 servos over I2C from a
Raspberry Pi 5 using the Adafruit CircuitPython ServoKit stack.

Wiring (default channels — override via .env):
    PCA9685 ch 0  → RECYCLABLE servo signal
    PCA9685 ch 4  → COMPOST   servo signal
    PCA9685 ch 8  → TRASH     servo signal
    PCA9685 ch 12 → HAZARDOUS servo signal

The PCA9685 V+ rail must be powered from an external 5 V supply (NOT the Pi)
sized for stall current of all servos. Tie all grounds together.

Same public interface as BinSimulator/BinController so the rest of the
code is hardware-agnostic.
"""

import logging
import threading
import time

from backend.config import settings
from backend.hardware.simulator import _broadcast, VALID_BINS, _lid_states

logger = logging.getLogger(__name__)


class PCA9685Controller:
    def __init__(self):
        # Adafruit imports are deferred — they only resolve on a real Pi with
        # the blinka stack installed. If they fail we let the factory swap us
        # for the simulator.
        import board                      # noqa: F401
        import busio
        from adafruit_pca9685 import PCA9685
        from adafruit_motor import servo as _servo_lib

        self._servo_lib = _servo_lib
        i2c = busio.I2C(board.SCL, board.SDA)
        self._pca = PCA9685(i2c, address=settings.pca9685_address)
        self._pca.frequency = settings.pca9685_freq_hz

        self._channels = {
            "RECYCLABLE": settings.pca9685_channel_recyclable,
            "COMPOST":    settings.pca9685_channel_compost,
            "TRASH":      settings.pca9685_channel_trash,
            "HAZARDOUS":  settings.pca9685_channel_hazardous,
        }
        self._servos: dict[str, object] = {}
        for bin_type, ch in self._channels.items():
            s = _servo_lib.Servo(
                self._pca.channels[ch],
                min_pulse=settings.servo_closed_us,
                max_pulse=settings.servo_open_us,
            )
            s.angle = 0
            self._servos[bin_type] = s

        logger.info(
            "PCA9685Controller initialised "
            f"(addr=0x{settings.pca9685_address:02x}, "
            f"freq={settings.pca9685_freq_hz}Hz, channels={self._channels})"
        )

    def _set_angle(self, bin_type: str, angle: float) -> None:
        servo = self._servos.get(bin_type)
        if servo is None:
            raise ValueError(f"Unknown bin: {bin_type}")
        servo.angle = angle

    def open_lid(self, bin_type: str, duration: int = 5) -> None:
        if bin_type not in VALID_BINS:
            raise ValueError(f"Unknown bin: {bin_type}")
        self._set_angle(bin_type, 180)
        _lid_states[bin_type] = True
        _broadcast({"type": "lid_open", "bin": bin_type, "timestamp": time.time()})
        logger.info(f"[PCA9685] {bin_type} lid OPEN for {duration}s")

        def _auto_close() -> None:
            time.sleep(duration)
            self.close_lid(bin_type)

        threading.Thread(target=_auto_close, daemon=True).start()

    def close_lid(self, bin_type: str) -> None:
        if bin_type not in VALID_BINS:
            raise ValueError(f"Unknown bin: {bin_type}")
        self._set_angle(bin_type, 0)
        _lid_states[bin_type] = False
        _broadcast({"type": "lid_close", "bin": bin_type, "timestamp": time.time()})
        logger.info(f"[PCA9685] {bin_type} lid CLOSED")

    def close_all(self) -> None:
        for bin_type in self._channels:
            self.close_lid(bin_type)

    def cleanup(self) -> None:
        try:
            self.close_all()
            self._pca.deinit()
        except Exception as exc:  # pragma: no cover — best-effort shutdown
            logger.warning(f"PCA9685 cleanup encountered: {exc}")
