"""
Real hardware bin controller — Raspberry Pi GPIO + servo motors.
Only instantiated when HARDWARE_MODE=true in .env.
Falls back to BinSimulator transparently when GPIO is unavailable.
"""

import logging
import time

from backend.config import settings

logger = logging.getLogger(__name__)

SERVO_PINS = {
    "RECYCLABLE": settings.servo_pin_recyclable,
    "COMPOST":    settings.servo_pin_compost,
    "TRASH":      settings.servo_pin_trash,
    "HAZARDOUS":  settings.servo_pin_hazardous,
}

# PWM duty cycle: 2.5 = 0° (closed), 12.5 = 180° (open)
CLOSED_DUTY = 2.5
OPEN_DUTY   = 12.5
PWM_FREQ    = 50  # Hz — standard for SG90/MG996R servos


class BinController:
    def __init__(self):
        try:
            import RPi.GPIO as GPIO
            self._gpio = GPIO
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            self._pwms: dict[str, object] = {}
            for bin_type, pin in SERVO_PINS.items():
                GPIO.setup(pin, GPIO.OUT)
                pwm = GPIO.PWM(pin, PWM_FREQ)
                pwm.start(CLOSED_DUTY)
                self._pwms[bin_type] = pwm
            logger.info("BinController initialised with real GPIO")
        except (ImportError, RuntimeError) as exc:
            logger.warning(f"RPi.GPIO unavailable ({exc}), trying gpiozero fallback")
            try:
                from gpiozero import Servo
                self._gpio = None
                self._servos: dict[str, object] = {}
                for bin_type, pin in SERVO_PINS.items():
                    servo = Servo(pin)
                    servo.value = -1
                    self._servos[bin_type] = servo
                logger.info("BinController initialised with gpiozero")
            except (ImportError, RuntimeError) as exc2:
                logger.warning(f"gpiozero unavailable ({exc2}), switching to simulator")
                from backend.hardware.simulator import BinSimulator
                self._delegate = BinSimulator()
                self._gpio = None

    def open_lid(self, bin_type: str, duration: int = 5) -> None:
        if hasattr(self, "_delegate"):
            self._delegate.open_lid(bin_type, duration)
            return

        if hasattr(self, "_pwms"):
            if bin_type not in self._pwms:
                raise ValueError(f"Unknown bin: {bin_type}")
            self._pwms[bin_type].ChangeDutyCycle(OPEN_DUTY)
        elif hasattr(self, "_servos"):
            if bin_type not in self._servos:
                raise ValueError(f"Unknown bin: {bin_type}")
            self._servos[bin_type].value = 1
        else:
            raise RuntimeError("No hardware controller available")

        logger.info(f"[HW] {bin_type} lid OPEN")
        time.sleep(duration)
        self.close_lid(bin_type)

    def close_lid(self, bin_type: str) -> None:
        if hasattr(self, "_delegate"):
            self._delegate.close_lid(bin_type)
            return

        if hasattr(self, "_pwms"):
            self._pwms[bin_type].ChangeDutyCycle(CLOSED_DUTY)
        elif hasattr(self, "_servos"):
            self._servos[bin_type].value = -1
        else:
            raise RuntimeError("No hardware controller available")
        logger.info(f"[HW] {bin_type} lid CLOSED")

    def close_all(self) -> None:
        if hasattr(self, "_delegate"):
            self._delegate.close_all()
            return
        for bin_type in self._pwms:
            self.close_lid(bin_type)

    def cleanup(self) -> None:
        if hasattr(self, "_delegate"):
            self._delegate.cleanup()
            return

        if self._gpio and not hasattr(self, "_delegate"):
            self.close_all()
            self._gpio.cleanup()

        if hasattr(self, "_servos"):
            for servo in self._servos.values():
                try:
                    servo.close()
                except Exception:
                    pass


def get_controller():
    """
    Factory: returns the right controller based on config.

    Selection order:
      1. hardware_mode = false  → BinSimulator (always safe on non-Pi hosts)
      2. hardware_mode = true + hardware_driver = pca9685 → PCA9685Controller
         (falls back to BinSimulator if I2C/PCA9685 libs aren't available)
      3. hardware_mode = true + hardware_driver = gpio    → BinController
         (direct GPIO PWM; also falls back internally)
    """
    if not settings.hardware_mode:
        from backend.hardware.simulator import BinSimulator
        return BinSimulator()

    if settings.hardware_driver == "pca9685":
        try:
            from backend.hardware.pca9685_controller import PCA9685Controller
            return PCA9685Controller()
        except Exception as exc:
            logger.warning(
                f"PCA9685 controller unavailable ({exc}); falling back to simulator."
            )
            from backend.hardware.simulator import BinSimulator
            return BinSimulator()

    return BinController()
