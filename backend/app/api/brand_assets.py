import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.core.config import settings
from app.database.session import get_db
from app.models.entities import (
    BrandAsset,
    BrandRule,
    ContentSubmission,
    User,
    VisualAnalysisRecord,
    VisualReviewHistory,
)
from app.schemas.brand_assets import (
    BrandAssetRead,
    VisualComplianceReport,
    VisualReviewDecision,
)
from app.services.file_storage import cleanup_failed_upload, persist_upload, read_validated_upload
from app.services.audit import record_audit
from app.services.review_assignments import (
    can_review_assignment,
    complete_pending_assignments,
)
from app.services.visual_brand_compliance import (
    SUPPORTED_IMAGE_EXTENSIONS,
    analyze_visual_asset_with_providers,
    validate_image_upload,
)

router = APIRouter(prefix="/api/brand-assets", tags=["brand-assets"])
VISUAL_REVIEW_ROLES = ("admin", "brand_manager", "reviewer")


def _serialize_visual_report(db: Session, record: VisualAnalysisRecord) -> dict:
    report = json.loads(record.result_json)
    history = db.scalars(
        select(VisualReviewHistory)
        .where(
            VisualReviewHistory.visual_analysis_id == record.id,
            VisualReviewHistory.organization_id == record.organization_id,
        )
        .order_by(VisualReviewHistory.created_at.asc())
    ).all()
    report.update(
        {
            "analysis_id": record.id,
            "review_status": record.review_status,
            "review_history": [
                {
                    "decision": entry.decision,
                    "previous_status": entry.previous_status,
                    "new_status": entry.new_status,
                    "comment": entry.comment,
                    "created_at": entry.created_at,
                }
                for entry in history
            ],
        }
    )
    return report


@router.post("/upload", response_model=BrandAssetRead, status_code=201)
async def upload_brand_asset(
    file: UploadFile = File(...),
    asset_kind: Literal["creative", "logo_reference"] = Form(default="creative"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filename, content = await read_validated_upload(file, SUPPORTED_IMAGE_EXTENSIONS)
    try:
        validate_image_upload(filename, content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    path = persist_upload(user.organization_id, filename, content)
    asset = BrandAsset(
        organization_id=user.organization_id,
        uploaded_by=user.id,
        filename=filename,
        storage_path=path,
        media_type=file.content_type or "application/octet-stream",
        asset_kind=asset_kind,
    )
    try:
        db.add(asset)
        db.flush()
        record_audit(db, user, "brand_asset.upload", "brand_asset", asset.id)
        db.commit()
    except Exception:
        db.rollback()
        cleanup_failed_upload(path)
        raise
    db.refresh(asset)
    return asset


@router.put("/{asset_id}/approve", response_model=BrandAssetRead)
def approve_brand_asset(
    asset_id: str,
    user: User = Depends(require_roles("admin", "brand_manager")),
    db: Session = Depends(get_db),
):
    asset = db.scalar(
        select(BrandAsset).where(
            BrandAsset.id == asset_id,
            BrandAsset.organization_id == user.organization_id,
        )
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Brand asset not found.")
    if not asset.approved:
        asset.approved = True
        record_audit(db, user, "brand_asset.approve", "brand_asset", asset.id)
        db.commit()
        db.refresh(asset)
    return asset


@router.get("", response_model=list[BrandAssetRead])
def list_brand_assets(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        select(BrandAsset)
        .where(BrandAsset.organization_id == user.organization_id)
        .order_by(BrandAsset.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return list(db.scalars(query))


@router.get("/{asset_id}", response_model=BrandAssetRead)
def get_brand_asset(
    asset_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = db.scalar(
        select(BrandAsset).where(
            BrandAsset.id == asset_id,
            BrandAsset.organization_id == user.organization_id,
        )
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Brand asset not found.")
    return asset


@router.post("/{asset_id}/analyze", response_model=VisualComplianceReport)
def analyze_brand_asset(
    asset_id: str,
    submission_id: str | None = Query(default=None),
    logo_required: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if submission_id is not None:
        submission_exists = db.scalar(
            select(ContentSubmission.id).where(
                ContentSubmission.id == submission_id,
                ContentSubmission.organization_id == user.organization_id,
            )
        )
        if submission_exists is None:
            raise HTTPException(status_code=404, detail="Content submission not found.")

    asset = db.scalar(
        select(BrandAsset).where(
            BrandAsset.id == asset_id,
            BrandAsset.organization_id == user.organization_id,
        )
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Brand asset not found.")
    try:
        file_path = Path(asset.storage_path).resolve()
        if settings.upload_path.resolve() not in file_path.parents:
            raise HTTPException(status_code=500, detail="Stored asset path is invalid.")
        content = file_path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="The stored asset could not be read.") from exc

    approved_assets = db.scalars(
        select(BrandAsset).where(
            BrandAsset.organization_id == user.organization_id,
            BrandAsset.id != asset.id,
            BrandAsset.asset_kind == "logo_reference",
            BrandAsset.approved.is_(True),
        ).order_by(BrandAsset.created_at.desc())
    ).all()
    approved_rules = db.scalars(
        select(BrandRule).where(
            BrandRule.organization_id == user.organization_id,
            BrandRule.approved.is_(True),
        )
    ).all()
    approved_colour_references: dict[str, list[dict]] = {}
    for rule in approved_rules:
        colours = dict.fromkeys(
            re.findall(
                r"(?i)(?<![\w])#(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])",
                rule.rule_text,
            )
        )
        for colour in colours:
            normalized_colour = colour.lower()
            approved_colour_references.setdefault(normalized_colour, []).append(
                {
                    "rule_id": rule.id,
                    "title": rule.title,
                    "guideline_id": rule.guideline_id,
                    "source_section": rule.source_section,
                    "source_page": rule.source_page,
                }
            )
    approved_references = []
    for reference in approved_assets[:3]:
        try:
            reference_path = Path(reference.storage_path).resolve()
            if settings.upload_path.resolve() not in reference_path.parents:
                raise HTTPException(status_code=500, detail="Approved asset path is invalid.")
            reference_content = reference_path.read_bytes()
        except OSError as exc:
            raise HTTPException(
                status_code=500, detail="An approved reference asset could not be read."
            ) from exc
        approved_references.append(
            {
                "id": reference.id,
                "filename": reference.filename,
                "content": reference_content,
                "media_type": reference.media_type,
            }
        )
    media_type = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".gif": "image/gif",
    }.get(Path(asset.filename).suffix.lower(), "application/octet-stream")
    report = analyze_visual_asset_with_providers(
        asset.filename,
        content,
        media_type,
        approved_colours=list(approved_colour_references),
        approved_colour_references=approved_colour_references,
        approved_references=approved_references,
        logo_required=logo_required,
    )
    report["asset_id"] = asset.id
    report["submission_id"] = submission_id
    report["image_reference"] = asset.filename
    record = VisualAnalysisRecord(
        organization_id=user.organization_id,
        asset_id=asset.id,
        submission_id=submission_id,
        analyzed_by=user.id,
        provider_status=report["provider_status"]["vision"],
        result_json=json.dumps(report, ensure_ascii=False),
    )
    db.add(record)
    db.flush()
    report["analysis_id"] = record.id
    record.result_json = json.dumps(report, ensure_ascii=False)
    record_audit(db, user, "brand_asset.analyze", "visual_analysis", record.id)
    db.commit()
    db.refresh(record)
    return report


@router.get("/{asset_id}/analysis/latest", response_model=VisualComplianceReport)
def latest_visual_analysis(
    asset_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = db.scalar(
        select(BrandAsset).where(
            BrandAsset.id == asset_id,
            BrandAsset.organization_id == user.organization_id,
        )
    )
    if asset is None:
        raise HTTPException(status_code=404, detail="Brand asset not found.")
    record = db.scalar(
        select(VisualAnalysisRecord)
        .where(
            VisualAnalysisRecord.asset_id == asset.id,
            VisualAnalysisRecord.organization_id == user.organization_id,
        )
        .order_by(VisualAnalysisRecord.created_at.desc())
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Visual analysis not found.")
    if user.role == "reviewer" and not can_review_assignment(
        db, user.organization_id, "visual", record.id, user.id
    ):
        raise HTTPException(status_code=403, detail="This item is assigned to another reviewer.")
    return _serialize_visual_report(db, record)


@router.post(
    "/{asset_id}/analysis/{analysis_id}/review",
    response_model=VisualComplianceReport,
)
def review_visual_analysis(
    asset_id: str,
    analysis_id: str,
    payload: VisualReviewDecision,
    user: User = Depends(require_roles(*VISUAL_REVIEW_ROLES)),
    db: Session = Depends(get_db),
):
    record = db.scalar(
        select(VisualAnalysisRecord).where(
            VisualAnalysisRecord.id == analysis_id,
            VisualAnalysisRecord.asset_id == asset_id,
            VisualAnalysisRecord.organization_id == user.organization_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Visual analysis not found.")
    if payload.decision != "approve" and not (payload.comment and payload.comment.strip()):
        raise HTTPException(
            status_code=422,
            detail="A reviewer comment is required when rejecting or requesting revision.",
        )
    new_status = {
        "approve": "approved",
        "reject": "rejected",
        "request_revision": "revision_requested",
    }[payload.decision]
    previous_status = record.review_status
    history = VisualReviewHistory(
        organization_id=user.organization_id,
        visual_analysis_id=record.id,
        reviewer_id=user.id,
        decision=payload.decision,
        previous_status=previous_status,
        new_status=new_status,
        comment=payload.comment.strip() if payload.comment else None,
    )
    record.review_status = new_status
    record.reviewed_by = user.id
    record.reviewed_at = datetime.now(timezone.utc)
    record.review_comment = payload.comment.strip() if payload.comment else None
    db.add(history)
    record_audit(
        db, user, f"visual_analysis.review.{payload.decision}", "visual_analysis", record.id
    )
    complete_pending_assignments(db, user.organization_id, "visual", record.id)
    db.commit()
    db.refresh(record)
    return _serialize_visual_report(db, record)
