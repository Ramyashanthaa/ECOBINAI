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
    servo_pin_recyclable: int = 17
    servo_pin_compost: int = 27
    servo_pin_trash: int = 22
    servo_pin_hazardous: int = 10

    # Camera
    camera_index: int | str = 0
    camera_resolution_w: int = 640
    camera_resolution_h: int = 480

    # App
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    database_url: str = "sqlite:///./ecobin.db"
    lid_open_duration: int = 60


settings = Settings()
