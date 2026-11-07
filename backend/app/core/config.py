import secrets
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_ROOT.parent if BACKEND_ROOT.name.lower() == "backend" else BACKEND_ROOT


class Settings(BaseSettings):
    app_name: str = "BrandGuard AI"
    environment: str = "development"
    database_url: str = "sqlite:///./brandguard.db"
    frontend_url: str = "http://localhost:5173"
    allowed_origins: str = "http://localhost:5173,http://localhost:3000"
    sqlalchemy_echo: bool = False
    jwt_secret_key: str = ""
    access_token_expire_minutes: int = 60
    upload_directory: str = str(PROJECT_ROOT / "uploads")
    max_upload_size_bytes: int = 10 * 1024 * 1024
    chroma_persist_directory: str = str(PROJECT_ROOT / "chroma_db")
    embedding_model: str = "all-MiniLM-L6-v2"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_ms: int = Field(default=15000, gt=0, le=120000)
    clamav_host: str = ""
    clamav_port: int = Field(default=3310, ge=1, le=65535)
    clamav_timeout_seconds: float = Field(default=10, gt=0, le=60)

    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value):
        if not isinstance(value, str):
            return value
        environment = value.strip().lower()
        if environment not in {"development", "demo", "production"}:
            raise ValueError("ENVIRONMENT must be development, demo, or production.")
        return environment

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_directory)
        return path if path.is_absolute() else PROJECT_ROOT / path

    @property
    def chroma_path(self) -> Path:
        path = Path(self.chroma_persist_directory)
        return path if path.is_absolute() else PROJECT_ROOT / path

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_postgres_url(cls, value):
        if isinstance(value, str) and value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if isinstance(value, str) and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @model_validator(mode="after")
    def validate_runtime_configuration(self):
        if not self.jwt_secret_key:
            if self.environment.lower() == "production":
                raise ValueError("Production requires JWT_SECRET_KEY.")
            self.jwt_secret_key = secrets.token_urlsafe(48)
        if len(self.jwt_secret_key) < 32:
            raise ValueError("JWT_SECRET_KEY must contain at least 32 characters.")
        if self.environment.lower() == "production":
            if not self.database_url.startswith("postgresql+psycopg://"):
                raise ValueError("Production requires a PostgreSQL DATABASE_URL.")
            ssl_modes = parse_qs(urlsplit(self.database_url).query).get("sslmode", [])
            if not ssl_modes or ssl_modes[0] not in ("require", "verify-ca", "verify-full"):
                raise ValueError("Production DATABASE_URL must require TLS with sslmode.")
            if self.jwt_secret_key == "replace-with-a-long-random-secret":
                raise ValueError("Production requires a non-placeholder JWT_SECRET_KEY.")
            if not self.clamav_host.strip():
                raise ValueError("Production requires CLAMAV_HOST for upload malware scanning.")
            origins = self.cors_origins
            if not origins or any(not _is_production_origin(origin) for origin in origins):
                raise ValueError("Production ALLOWED_ORIGINS must contain HTTPS origins only.")
            if not _is_production_origin(self.frontend_url):
                raise ValueError("Production FRONTEND_URL must be an HTTPS origin.")
            if self.sqlalchemy_echo:
                raise ValueError("SQLALCHEMY_ECHO must be disabled in production.")
        return self


def _is_production_origin(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and bool(parsed.netloc)
        and bool(hostname)
        and parsed.path in ("", "/")
        and not parsed.query
        and not parsed.fragment
        and parsed.username is None
        and parsed.password is None
        and hostname not in ("localhost", "127.0.0.1", "::1", "*")
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
