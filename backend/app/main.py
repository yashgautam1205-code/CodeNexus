from contextlib import asynccontextmanager
import logging
import os
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.diagnostics import log_exception_trace
from app.api.auth import router as auth_router
from app.api.brand_assets import router as brand_assets_router
from app.api.content import router as content_router
from app.api.analysis import router as analysis_router
from app.api.corrections import router as corrections_router
from app.api.dashboard import router as dashboard_router
from app.api.evidence import router as evidence_router
from app.api.guidelines import router as guidelines_router
from app.api.health import router as health_router
from app.api.reviews import router as reviews_router
from app.api.review_assignments import router as review_assignments_router
from app.core.config import settings

logger = logging.getLogger(__name__)


def ensure_production_storage() -> None:
    storage_root = settings.persistent_storage_root_path
    if not storage_root.is_mount():
        raise RuntimeError(
            "PERSISTENT_STORAGE_ROOT is not an attached filesystem mount; refusing to start with ephemeral storage."
        )
    for label, path in (
        ("UPLOAD_DIRECTORY", settings.upload_path),
        ("CHROMA_PERSIST_DIRECTORY", settings.chroma_path),
    ):
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise RuntimeError(f"{label} is unavailable on persistent storage.") from exc
        if not os.access(path, os.W_OK | os.X_OK):
            raise RuntimeError(f"{label} is not writable on persistent storage.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.environment == "production":
        ensure_production_storage()
    yield

app = FastAPI(
    title=settings.app_name,
    description="Explainable brand governance and content verification API.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_login_requests(request: Request, call_next):
    if request.method != "POST" or request.url.path != "/api/auth/login":
        return await call_next(request)

    started_at = perf_counter()
    logger.info("event=login_request_received elapsed_ms=0")
    try:
        response = await call_next(request)
    except Exception as exc:
        log_exception_trace(
            logger,
            "event=login_request_failed",
            exc,
            duration_ms=round((perf_counter() - started_at) * 1000),
        )
        raise

    logger.info(
        "event=login_response_returned status_code=%d duration_ms=%d",
        response.status_code,
        round((perf_counter() - started_at) * 1000),
    )
    return response


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(content_router)
app.include_router(analysis_router)
app.include_router(corrections_router)
app.include_router(guidelines_router)
app.include_router(reviews_router)
app.include_router(review_assignments_router)
app.include_router(dashboard_router)
app.include_router(brand_assets_router)
app.include_router(evidence_router)


@app.get("/", tags=["root"])
def root():
    return {"name": settings.app_name, "docs": "/docs", "health": "/api/health"}
