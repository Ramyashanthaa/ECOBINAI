from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Gemma 4 backend
    gemma_backend: Literal["google_ai_studio", "ollama", "huggingface"] = "ollama"
    google_ai_api_key: str = ""
    gemma_model: str = "gemma-4-it"

    # Ollama (local / edge)
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4"

    # Hardware
    hardware_mode: bool = False
    # GPIO BCM pins (used only when hardware_driver == "gpio")
    servo_pin_recyclable: int = 17
    servo_pin_compost: int = 27
    servo_pin_trash: int = 22
    servo_pin_hazardous: int = 10

    # Servo driver — "gpio" (direct PWM on GPIO pins) or "pca9685" (I2C 16-channel)
    hardware_driver: Literal["gpio", "pca9685"] = "gpio"
    # PCA9685 I2C address and channels for each bin (0–15). SG90s: 50 Hz, 1–2 ms.
    pca9685_address: int = 0x40
    pca9685_freq_hz: int = 50
    pca9685_channel_recyclable: int = 0
    pca9685_channel_compost: int = 4
    pca9685_channel_trash: int = 8
    pca9685_channel_hazardous: int = 12
    # SG90 calibration — pulse widths in microseconds at closed / open angles.
    servo_closed_us: int = 600     # ~0°
    servo_open_us: int = 2400      # ~180°

    # Camera (used by the on-device USB-camera capture loop when enabled)
    camera_index: int | str = 0
    camera_resolution_w: int = 640
    camera_resolution_h: int = 480
    # Headless capture loop — runs the classifier on frames from the USB cam
    # without needing a browser. Required for the standalone Raspberry Pi mode.
    usb_camera_enabled: bool = False
    usb_camera_interval_s: float = 1.5
    usb_camera_scene_diff_threshold: float = 12.0

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    database_url: str = "sqlite:///./ecobin.db"
    lid_open_duration: int = 3600  # effectively until the next item is scanned (resets on new classification)


settings = Settings()
