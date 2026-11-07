from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user
from app.database.session import get_db
from app.core.rate_limit import limit_user_uploads
from app.models.entities import ContentSubmission, User
from app.schemas.content import ContentRead
from app.services.audit import record_audit
from app.services.document_extraction import DocumentExtractionError, extract_document_text
from app.services.file_storage import (
    cleanup_failed_upload,
    persist_upload,
    read_validated_upload,
)

router = APIRouter(prefix="/api/content", tags=["content"])


@router.post("/upload", response_model=ContentRead, status_code=201)
async def upload_content(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit_user_uploads(user)
    filename, content = await read_validated_upload(file, {".pdf", ".docx", ".txt"})
    try:
        extracted_text = extract_document_text(filename, content)
    except DocumentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    path = persist_upload(user.organization_id, filename, content)
    submission = ContentSubmission(
        organization_id=user.organization_id,
        submitted_by=user.id,
        filename=filename,
        storage_path=path,
        extracted_text=extracted_text,
        status="ready",
        review_status="pending",
    )
    try:
        db.add(submission)
        db.flush()
        record_audit(db, user, "content.upload", "content_submission", submission.id)
        db.commit()
    except Exception:
        db.rollback()
        cleanup_failed_upload(path)
        raise
    db.refresh(submission)
    return submission


@router.get("", response_model=list[ContentRead])
def list_content(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        select(ContentSubmission)
        .where(ContentSubmission.organization_id == user.organization_id)
        .order_by(ContentSubmission.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(query))


@router.get("/{submission_id}", response_model=ContentRead)
def get_content(
    submission_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    submission = db.scalar(
        select(ContentSubmission).where(
            ContentSubmission.id == submission_id,
            ContentSubmission.organization_id == user.organization_id,
        )
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Content submission not found.")
    return submission
