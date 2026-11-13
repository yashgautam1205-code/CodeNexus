from typing import Literal

from pydantic import BaseModel, Field


class EvidenceReference(BaseModel):
    id: str | None = None
    title: str | None = None
    text: str | None = None
    source_section: str | None = None
    source_page: int | None = None
    guideline_id: str | None = None
    source_url: str | None = None
    source_type: str | None = None
    provider: str | None = None
    evidence_relation: str | None = None
    published_at: str | None = None
    retrieved_at: str | None = None
    credibility_score: float | None = None
    relevance_score: float | None = None
    freshness_days: int | None = None
    freshness_status: str | None = None
    publisher_domain: str | None = None
    publication_date_status: str | None = None
    citation_valid: bool | None = None


class ClaimExtractionRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ClaimVerificationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    evidence: list[EvidenceReference] = Field(default_factory=list)
    submission_id: str | None = None


class ClaimResult(BaseModel):
    id: str
    claim_text: str
    claim_type: Literal[
        "objective_factual",
        "statistical",
        "product_performance",
        "superiority",
        "subjective_marketing",
    ] = "objective_factual"
    time_sensitive: bool = False
    status: Literal[
        "supported",
        "contradicted",
        "insufficient_evidence",
        "needs_review",
    ]
    confidence: float
    evidence: list[EvidenceReference] = Field(default_factory=list)
    reason: str
    provider_status: str = "not_configured"
    assessment_status: str = "not_attempted"
    assessment_model: str | None = None
    assessment_rationale: str | None = None
    assessment_source_ids: list[str] = Field(default_factory=list)
    assessment_error_type: str | None = None
    assessment_error_code: int | None = None
    retrieval_timestamp: str | None = None
    last_verified_at: str | None = None
    review_status: str = "pending"
    review_comment: str | None = None
    review_history: list[dict] = Field(default_factory=list)


class ClaimReviewDecision(BaseModel):
    decision: Literal["approve", "reject", "request_additional_evidence"]
    comment: str | None = Field(default=None, max_length=2000)
