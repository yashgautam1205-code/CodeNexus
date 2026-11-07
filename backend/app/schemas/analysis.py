from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


EvidenceStatus = Literal["supported", "contradicted", "no_source_found", "needs_verification"]
Severity = Literal["critical", "high", "medium", "low"]


class LLMFinding(BaseModel):
    category: Literal[
        "tone_of_voice",
        "brand_messaging",
        "contradiction",
        "unsupported_claim",
        "product_information",
        "other",
    ]
    affected_text: str = Field(max_length=2000)
    explanation: str = Field(max_length=2000)
    severity: Severity
    confidence: float = Field(ge=0, le=1)
    evidence_rule_id: str | None = None
    suggested_correction: str | None = Field(default=None, max_length=4000)


class LLMAnalysisOutput(BaseModel):
    findings: list[LLMFinding] = Field(default_factory=list, max_length=30)


class FindingRead(BaseModel):
    id: str
    category: str
    affected_text: str
    explanation: str
    severity: Severity
    confidence: float
    evidence_status: EvidenceStatus
    evidence_text: str | None
    guideline_id: str | None
    guideline_title: str | None
    source_section: str | None
    source_page: int | None
    suggested_correction: str | None

    model_config = ConfigDict(from_attributes=True)


class AnalysisRead(BaseModel):
    id: str
    submission_id: str
    compliance_score: float
    analysis_status: str
    analysis_note: str | None
    score_formula: str
    created_at: datetime
    findings: list[FindingRead]

    model_config = ConfigDict(from_attributes=True)


class SuggestionDecision(BaseModel):
    decision: Literal["accepted", "rejected", "edited"]
    suggested_text: str | None = Field(default=None, max_length=8000)
