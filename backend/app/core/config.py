from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
import json


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    APP_NAME: str = "ArtFrame"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    SECRET_KEY: str = "change-me-please-use-a-long-random-string"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    ALGORITHM: str = "HS256"

    DATABASE_URL: str = "sqlite+aiosqlite:///./artframe.db"

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    CORS_ORIGIN_REGEX: str = ""

    STORAGE_PATH: str = "./storage"
    MAX_UPLOAD_SIZE_MB: int = 25

    OTP_EXPIRE_MINUTES: int = 10
    OTP_LENGTH: int = 6

    EMAIL_ENABLED: bool = False
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@artframe.local"

    GEMINI_API_KEY: str = ""

    VOICE_CONVERSION_PROVIDER: str = "local"
    VOICE_CONVERSION_ENDPOINT: str = ""
    VOICE_CONVERSION_TOKEN: str = ""
    VOICE_CONVERSION_TIMEOUT_SECONDS: int = 120
    VOICE_MODEL_MALE_TO_FEMALE: str = ""
    VOICE_MODEL_FEMALE_TO_MALE: str = ""
    VOICE_MODEL_YOUNGER: str = ""
    VOICE_MODEL_OLDER: str = ""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        # Support CORS_ORIGINS as JSON-ish string in .env
        if isinstance(self.CORS_ORIGINS, str):
            try:
                self.CORS_ORIGINS = json.loads(self.CORS_ORIGINS)
            except Exception:
                self.CORS_ORIGINS = [o.strip() for o in self.CORS_ORIGINS.split(",")]


settings = Settings()
