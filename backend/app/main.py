from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.content import router as content_router
from app.api.analysis import router as analysis_router
from app.api.corrections import router as corrections_router
from app.api.dashboard import router as dashboard_router
from app.api.guidelines import router as guidelines_router
from app.api.health import router as health_router
from app.api.reviews import router as reviews_router
from app.core.config import settings
from app.database.session import Base, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.environment == "development":
        Base.metadata.create_all(bind=engine)
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

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(content_router)
app.include_router(analysis_router)
app.include_router(corrections_router)
app.include_router(guidelines_router)
app.include_router(reviews_router)
app.include_router(dashboard_router)


@app.get("/", tags=["root"])
def root():
    return {"name": settings.app_name, "docs": "/docs", "health": "/api/health"}
