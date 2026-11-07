from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.session import get_db

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health():
    return {"status": "ok", "service": "brandguard-api"}


@router.get("/database")
def database_health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable. Check DATABASE_URL and database service.",
        ) from None
    return {"status": "ok", "database": "connected"}
