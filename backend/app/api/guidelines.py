import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.core.config import settings
from app.core.rate_limit import limit_user_uploads
from app.database.session import get_db
from app.models.entities import BrandGuideline, BrandRule, User
from app.schemas.guidelines import (
    GuidelineRead,
    GuidelineUpdate,
    RuleCreate,
    RuleRead,
    RuleUpdate,
)
from app.services.audit import record_audit
from app.services.document_extraction import DocumentExtractionError, extract_document_text
from app.services.file_storage import (
    cleanup_failed_upload,
    persist_upload,
    read_validated_upload,
)
from app.rag.guideline_index import index_approved_rule, remove_rule_from_index

router = APIRouter(tags=["brand knowledge"])
logger = logging.getLogger(__name__)


def _update_rule_index(rule: BrandRule) -> None:
    try:
        index_approved_rule(rule)
    except Exception as exc:
        logger.exception("Could not update guideline index for rule %s", rule.id)
        raise HTTPException(
            status_code=503,
            detail="Rule was saved, but its retrieval index could not be updated. Retry the rule update.",
        ) from exc


@router.post("/api/guidelines/upload", response_model=GuidelineRead, status_code=201)
async def upload_guideline(
    file: UploadFile = File(...),
    supersedes_guideline_id: str | None = Form(default=None),
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    limit_user_uploads(user)
    filename, content = await read_validated_upload(file, {".pdf", ".docx", ".txt"})
    try:
        extracted_text = extract_document_text(filename, content)
    except DocumentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    previous_version = None
    if supersedes_guideline_id:
        previous_version = db.scalar(
            select(BrandGuideline).where(
                BrandGuideline.id == supersedes_guideline_id,
                BrandGuideline.organization_id == user.organization_id,
            )
        )
        if previous_version is None:
            raise HTTPException(status_code=404, detail="Previous guideline version not found.")

    path = persist_upload(user.organization_id, filename, content)
    guideline = BrandGuideline(
        organization_id=user.organization_id,
        filename=filename,
        title=Path(filename).stem,
        storage_path=path,
        extracted_text=extracted_text,
        status="needs_review",
        version_number=(previous_version.version_number + 1) if previous_version else 1,
        supersedes_guideline_id=previous_version.id if previous_version else None,
        uploaded_by=user.id,
    )
    try:
        db.add(guideline)
        db.flush()
        record_audit(db, user, "guideline.upload", "brand_guideline", guideline.id)
        db.commit()
    except Exception:
        db.rollback()
        cleanup_failed_upload(path)
        raise
    db.refresh(guideline)
    return guideline


@router.post(
    "/api/guidelines/{guideline_id}/extract-rules",
    response_model=list[RuleRead],
    status_code=201,
)
def extract_candidate_rules(
    guideline_id: str,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    guideline = db.scalar(
        select(BrandGuideline).where(
            BrandGuideline.id == guideline_id,
            BrandGuideline.organization_id == user.organization_id,
        )
    )
    if guideline is None:
        raise HTTPException(status_code=404, detail="Guideline not found.")

    from app.services.candidate_rules import create_candidate_rules

    candidates = create_candidate_rules(db, guideline, user)
    for candidate in candidates:
        db.add(candidate)
    if candidates:
        db.flush()
        for candidate in candidates:
            record_audit(db, user, "rule.candidate_created", "brand_rule", candidate.id)
    db.commit()
    for candidate in candidates:
        db.refresh(candidate)
    return candidates


@router.put("/api/guidelines/{guideline_id}", response_model=GuidelineRead)
def update_guideline(
    guideline_id: str,
    payload: GuidelineUpdate,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    guideline = db.scalar(
        select(BrandGuideline).where(
            BrandGuideline.id == guideline_id,
            BrandGuideline.organization_id == user.organization_id,
        )
    )
    if guideline is None:
        raise HTTPException(status_code=404, detail="Guideline not found.")
    guideline.title = payload.title.strip()
    record_audit(db, user, "guideline.update", "brand_guideline", guideline.id)
    db.commit()
    db.refresh(guideline)
    return guideline


@router.get("/api/guidelines", response_model=list[GuidelineRead])
def list_guidelines(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list(
        db.scalars(
            select(BrandGuideline)
            .where(BrandGuideline.organization_id == user.organization_id)
            .order_by(BrandGuideline.created_at.desc())
        )
    )


@router.get("/api/guidelines/{guideline_id}", response_model=GuidelineRead)
def get_guideline(
    guideline_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    guideline = db.scalar(
        select(BrandGuideline).where(
            BrandGuideline.id == guideline_id,
            BrandGuideline.organization_id == user.organization_id,
        )
    )
    if guideline is None:
        raise HTTPException(status_code=404, detail="Guideline not found.")
    return guideline


@router.get("/api/guidelines/{guideline_id}/file")
def download_guideline(
    guideline_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    guideline = db.scalar(
        select(BrandGuideline).where(
            BrandGuideline.id == guideline_id,
            BrandGuideline.organization_id == user.organization_id,
        )
    )
    if guideline is None:
        raise HTTPException(status_code=404, detail="Guideline not found.")
    file_path = Path(guideline.storage_path).resolve()
    upload_root = settings.upload_path.resolve()
    if upload_root not in file_path.parents:
        raise HTTPException(status_code=500, detail="Stored document path is invalid.")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Original guideline file is unavailable.")
    return FileResponse(file_path, filename=guideline.filename)


@router.delete("/api/guidelines/{guideline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_guideline(
    guideline_id: str,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    guideline = db.scalar(
        select(BrandGuideline).where(
            BrandGuideline.id == guideline_id,
            BrandGuideline.organization_id == user.organization_id,
        )
    )
    if guideline is None:
        raise HTTPException(status_code=404, detail="Guideline not found.")
    file_path = Path(guideline.storage_path).resolve()
    upload_root = settings.upload_path.resolve()
    if upload_root not in file_path.parents:
        raise HTTPException(status_code=500, detail="Stored document path is invalid.")
    rule_ids = [rule.id for rule in guideline.rules]
    record_audit(db, user, "guideline.delete", "brand_guideline", guideline.id)
    db.delete(guideline)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    try:
        for rule_id in rule_ids:
            remove_rule_from_index(user.organization_id, rule_id)
        file_path.unlink(missing_ok=True)
    except Exception as exc:
        logger.exception("Guideline %s was deleted but cleanup failed", guideline.id)
        raise HTTPException(
            status_code=503,
            detail="Guideline was deleted, but its stored file or retrieval vectors could not be removed.",
        ) from exc


@router.post("/api/rules", response_model=RuleRead, status_code=201)
def create_rule(
    payload: RuleCreate,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    if payload.guideline_id is not None:
        guideline = db.scalar(
            select(BrandGuideline).where(
                BrandGuideline.id == payload.guideline_id,
                BrandGuideline.organization_id == user.organization_id,
            )
        )
        if guideline is None:
            raise HTTPException(status_code=404, detail="Guideline not found.")
    rule = BrandRule(
        organization_id=user.organization_id,
        created_by=user.id,
        **payload.model_dump(),
    )
    db.add(rule)
    db.flush()
    record_audit(db, user, "rule.create", "brand_rule", rule.id)
    db.commit()
    db.refresh(rule)
    if rule.approved:
        _update_rule_index(rule)
    return rule


@router.get("/api/rules", response_model=list[RuleRead])
def list_rules(
    approved: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(BrandRule).where(BrandRule.organization_id == user.organization_id)
    if approved is not None:
        query = query.where(BrandRule.approved.is_(approved))
    return list(db.scalars(query.order_by(BrandRule.created_at.desc())))


@router.get("/api/rules/{rule_id}", response_model=RuleRead)
def get_rule(
    rule_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = db.scalar(
        select(BrandRule).where(
            BrandRule.id == rule_id,
            BrandRule.organization_id == user.organization_id,
        )
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Brand rule not found.")
    return rule


@router.put("/api/rules/{rule_id}", response_model=RuleRead)
def update_rule(
    rule_id: str,
    payload: RuleUpdate,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    rule = db.scalar(
        select(BrandRule).where(
            BrandRule.id == rule_id,
            BrandRule.organization_id == user.organization_id,
        )
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Brand rule not found.")
    changes = payload.model_dump(exclude_unset=True)
    if "guideline_id" in changes and changes["guideline_id"] is not None:
        guideline = db.scalar(
            select(BrandGuideline).where(
                BrandGuideline.id == changes["guideline_id"],
                BrandGuideline.organization_id == user.organization_id,
            )
        )
        if guideline is None:
            raise HTTPException(status_code=404, detail="Guideline not found.")
    for key, value in changes.items():
        if key == "approved":
            rule.approved_at = datetime.now(timezone.utc) if value else None
        setattr(rule, key, value)
    if changes:
        record_audit(db, user, "rule.update", "brand_rule", rule.id)
    db.commit()
    db.refresh(rule)
    if changes:
        _update_rule_index(rule)
    return rule


@router.delete("/api/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: str,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    rule = db.scalar(
        select(BrandRule).where(
            BrandRule.id == rule_id,
            BrandRule.organization_id == user.organization_id,
        )
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Brand rule not found.")
    record_audit(db, user, "rule.delete", "brand_rule", rule.id)
    organization_id = rule.organization_id
    removed_rule_id = rule.id
    db.delete(rule)
    db.commit()
    try:
        remove_rule_from_index(organization_id, removed_rule_id)
    except Exception as exc:
        logger.exception("Could not remove deleted rule vector %s", removed_rule_id)
        raise HTTPException(
            status_code=503,
            detail="Rule was deleted, but its retrieval vector could not be removed.",
        ) from exc


@router.post("/api/rules/reindex", status_code=202)
def reindex_rules(
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    rules = db.scalars(
        select(BrandRule).where(
            BrandRule.organization_id == user.organization_id,
            BrandRule.approved.is_(True),
        )
    ).all()
    try:
        for rule in rules:
            index_approved_rule(rule)
    except Exception as exc:
        logger.exception("Could not rebuild guideline index for organization %s", user.organization_id)
        raise HTTPException(
            status_code=503,
            detail="The approved guideline index could not be rebuilt.",
        ) from exc
    return {"indexed_rules": len(rules)}
