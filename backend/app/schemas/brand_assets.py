from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BrandAssetRead(BaseModel):
    id: str
    organization_id: str
    uploaded_by: str
    filename: str
    storage_path: str
    media_type: str
    asset_kind: Literal["creative", "logo_reference"] = "creative"
    approved: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VisualComplianceFinding(BaseModel):
    id: str
    category: str
    severity: str
    description: str
    detected_value: str | None = None
    expected_brand_value: str | None = None
    confidence: float = 0.0
    recommended_correction: str | None = None
    verification_status: str = "needs_verification"
    evidence: list[dict] = Field(default_factory=list)


class VisualComplianceReport(BaseModel):
    analysis_id: str | None = None
    asset_id: str | None = None
    submission_id: str | None = None
    filename: str
    logo_required: bool = False
    image_reference: str | None = None
    image_dimensions: str | None = None
    dominant_colours: list[str] = Field(default_factory=list)
    approved_colours: list[str] = Field(default_factory=list)
    palette_status: Literal[
        "checked", "no_approved_palette", "needs_verification"
    ] = "no_approved_palette"
    findings: list[VisualComplianceFinding] = Field(default_factory=list)
    logo_matches: list[dict] = Field(default_factory=list)
    ocr_text: list[str] = Field(default_factory=list)
    ocr_regions: list[dict] = Field(default_factory=list)
    typography_analysis: dict = Field(default_factory=dict)
    layout_analysis: dict = Field(default_factory=dict)
    provider_status: dict[str, str | int | None] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    review_status: str = "pending"
    review_history: list[dict] = Field(default_factory=list)
    summary: str = ""


class VisualReviewDecision(BaseModel):
    decision: Literal["approve", "reject", "request_revision"]
    comment: str | None = Field(default=None, max_length=2000)
