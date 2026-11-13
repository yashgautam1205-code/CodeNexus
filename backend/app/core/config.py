import secrets
import tempfile
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
    persistent_storage_root: str = ""
    embedding_model: str = "all-MiniLM-L6-v2"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_fallback_model: str = "gemini-3.5-flash"
    gemini_timeout_ms: int = Field(default=60000, gt=0, le=120000)
    gemini_retry_attempts: int = Field(default=2, ge=1, le=3)
    external_search_provider: str = "disabled"
    tavily_api_key: str = ""
    external_search_timeout_seconds: float = Field(default=8, gt=0, le=30)
    external_search_max_results: int = Field(default=5, ge=1, le=10)
    external_claim_limit: int = Field(default=5, ge=1, le=30)
    evidence_freshness_days: int = Field(default=365, ge=1, le=3650)
    time_sensitive_freshness_days: int = Field(default=90, ge=1, le=365)
    tesseract_cmd: str = ""
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

    @field_validator("external_search_provider", mode="before")
    @classmethod
    def normalize_external_search_provider(cls, value):
        if not isinstance(value, str):
            return value
        provider = value.strip().lower()
        if provider not in {"disabled", "tavily"}:
            raise ValueError("EXTERNAL_SEARCH_PROVIDER must be disabled or tavily.")
        return provider

    @field_validator("gemini_api_key", "tavily_api_key", mode="before")
    @classmethod
    def normalize_provider_key(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("gemini_model", "gemini_fallback_model", mode="before")
    @classmethod
    def normalize_gemini_model(cls, value):
        return value.strip() if isinstance(value, str) else value

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

    @property
    def persistent_storage_root_path(self) -> Path:
        path = Path(self.persistent_storage_root)
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
            if "persistent_storage_root" not in self.model_fields_set:
                raise ValueError(
                    "Production requires PERSISTENT_STORAGE_ROOT to identify the mounted durable storage volume."
                )
            root = Path(self.persistent_storage_root)
            if not root.is_absolute() or _is_temporary_storage_path(root):
                raise ValueError(
                    "Production PERSISTENT_STORAGE_ROOT must be an absolute, non-temporary storage mount."
                )
            for field_name, environment_name, configured_path in (
                ("upload_directory", "UPLOAD_DIRECTORY", Path(self.upload_directory)),
                (
                    "chroma_persist_directory",
                    "CHROMA_PERSIST_DIRECTORY",
                    Path(self.chroma_persist_directory),
                ),
            ):
                if field_name not in self.model_fields_set:
                    raise ValueError(
                        f"Production requires {environment_name} to be explicitly configured under PERSISTENT_STORAGE_ROOT."
                    )
                if not configured_path.is_absolute():
                    raise ValueError(
                        f"Production {environment_name} must be an absolute path under PERSISTENT_STORAGE_ROOT."
                    )
                if _is_temporary_storage_path(configured_path):
                    raise ValueError(
                        f"Production {environment_name} cannot use temporary storage."
                    )
                try:
                    configured_path.resolve().relative_to(root.resolve())
                except ValueError as exc:
                    raise ValueError(
                        f"Production {environment_name} must be located under PERSISTENT_STORAGE_ROOT."
                    ) from exc
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


def _is_temporary_storage_path(path: Path) -> bool:
    try:
        resolved_path = path.resolve()
        temporary_roots = {
            Path(tempfile.gettempdir()).resolve(),
            Path("/tmp").resolve(),
            Path("/var/tmp").resolve(),
            Path("/dev/shm").resolve(),
        }
        for root in temporary_roots:
            try:
                resolved_path.relative_to(root)
            except ValueError:
                continue
            return True
    except OSError:
        return True
    return False


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
