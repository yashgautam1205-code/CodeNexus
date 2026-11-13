import json
import logging
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.gemini import analyze_with_gemini
from app.models.entities import (
    AnalysisResult,
    BrandGuideline,
    BrandRule,
    ClaimVerificationRecord,
    ContentSubmission,
    User,
    Violation,
    VisualAnalysisRecord,
    VisualReviewHistory,
)
from app.rag.guideline_index import (
    MAX_RETRIEVAL_DISTANCE,
    index_approved_rule,
    retrieve_guideline_chunks,
)
from app.services.audit import record_audit
from app.services.evidence_verification import verify_claims_with_external_sources
from app.services.verification_persistence import (
    persist_claim_verifications,
    serialize_claim_verification,
)

logger = logging.getLogger(__name__)
SEVERITY_WEIGHTS = {"critical": 25, "high": 15, "medium": 8, "low": 3}
SCORE_FORMULA = "severity-weighted-v1"
CLAIM_PATTERN = re.compile(
    r"(?<!\w)(?:guaranteed|clinically proven|proven to|number one|#1|100\s*%|zero risk)(?!\w)",
    re.IGNORECASE,
)


def _term_matches(content: str, term: str) -> list[str]:
    if not term.strip():
        return []
    pattern = re.compile(rf"(?<!\w){re.escape(term.strip())}(?!\w)", re.IGNORECASE)
    return [match.group(0) for match in pattern.finditer(content)]


def _deterministic_findings(content: str, rules: list[BrandRule]) -> list[dict]:
    findings: list[dict] = []
    for rule in rules:
        if rule.category == "prohibited_terminology" and rule.term:
            for matched in _term_matches(content, rule.term):
                findings.append(
                    {
                        "category": "prohibited_terminology",
                        "affected_text": matched,
                        "explanation": f"This text uses a term prohibited by the approved rule “{rule.title}”.",
                        "severity": "high",
                        "confidence": 1.0,
                        "evidence_status": "contradicted",
                        "source_rule": rule,
                        "suggested_correction": rule.replacement_text,
                    }
                )
        elif rule.category == "required_disclaimers" and rule.term:
            if rule.term.casefold() not in content.casefold():
                findings.append(
                    {
                        "category": "missing_disclaimer",
                        "affected_text": "",
                        "explanation": "A required disclaimer defined by an approved rule is missing.",
                        "severity": "high",
                        "confidence": 1.0,
                        "evidence_status": "contradicted",
                        "source_rule": rule,
                        "suggested_correction": rule.term,
                    }
                )

    for match in CLAIM_PATTERN.finditer(content):
        phrase = match.group(0)
        if not any(
            item["category"] == "prohibited_terminology"
            and item["affected_text"].casefold() == phrase.casefold()
            for item in findings
        ):
            findings.append(
                {
                    "category": "unsupported_claim",
                    "affected_text": phrase,
                    "explanation": (
                        "This absolute or efficacy claim needs a verifiable source. "
                        "No approved guideline source was found for this phrase; this does not establish that it is false."
                    ),
                    "severity": "medium",
                    "confidence": 0.62,
                    "evidence_status": "no_source_found",
                    "source_rule": None,
                    "suggested_correction": "Provide a verifiable source or qualify the claim.",
                }
            )
    return findings


def _retrieve_evidence(organization_id: str, content: str, rules: list[BrandRule]) -> tuple[list[dict], str | None]:
    retrieval_note = None
    try:
        hits = retrieve_guideline_chunks(organization_id, content)
        if not hits and rules:
            for rule in rules:
                index_approved_rule(rule)
            hits = retrieve_guideline_chunks(organization_id, content)
    except Exception:
        logger.exception("Approved guideline retrieval failed for organization %s", organization_id)
        return [], "Guideline retrieval was unavailable; deterministic checks were still applied."

    hit_rule_ids = {
        hit["metadata"].get("rule_id")
        for hit in hits
        if hit.get("metadata", {}).get("organization_id") == organization_id
        and hit.get("distance", float("inf")) <= MAX_RETRIEVAL_DISTANCE
    }
    relevant = [rule for rule in rules if rule.id in hit_rule_ids and rule.approved]
    return [
        {
            "id": rule.id,
            "category": rule.category,
            "title": rule.title,
            "text": rule.rule_text,
            "guideline_id": rule.guideline_id,
            "source_section": rule.source_section,
            "source_page": rule.source_page,
        }
        for rule in relevant
    ], retrieval_note


def _safe_llm_findings(content: str, output, evidence: list[dict]) -> list[dict]:
    evidence_by_id = {item["id"]: item for item in evidence}
    findings = []
    for item in output.findings:
        if not item.affected_text or item.affected_text not in content:
            continue
        source = evidence_by_id.get(item.evidence_rule_id or "")
        evidence_status = "no_source_found" if source is None else "needs_verification"
        findings.append(
            {
                "category": item.category,
                "affected_text": item.affected_text,
                "explanation": item.explanation,
                "severity": item.severity,
                "confidence": item.confidence,
                "evidence_status": evidence_status,
                "source_rule": source,
                "suggested_correction": item.suggested_correction,
            }
        )
    return findings


def _compliance_score(findings: list[dict]) -> float:
    penalty = sum(SEVERITY_WEIGHTS[finding["severity"]] for finding in findings)
    return float(max(0, 100 - min(100, penalty)))


def run_analysis(db: Session, user: User, submission: ContentSubmission) -> AnalysisResult:
    rules = list(
        db.scalars(
            select(BrandRule).where(
                BrandRule.organization_id == user.organization_id,
                BrandRule.approved.is_(True),
            )
        )
    )
    findings = _deterministic_findings(submission.extracted_text, rules)
    evidence, retrieval_note = _retrieve_evidence(
        user.organization_id, submission.extracted_text, rules
    )
    analysis_status = "partial"
    notes = []
    if retrieval_note:
        notes.append(retrieval_note)
    if not rules:
        notes.append("No approved brand rules are available for this organisation.")
    if not evidence and rules:
        notes.append("No relevant approved guideline evidence was retrieved for this content.")

    from app.core.config import settings

    if settings.gemini_api_key and evidence:
        try:
            llm_output = analyze_with_gemini(submission.extracted_text, evidence)
            existing = {
                (finding["category"], finding["affected_text"].casefold()) for finding in findings
            }
            findings.extend(
                item
                for item in _safe_llm_findings(submission.extracted_text, llm_output, evidence)
                if (item["category"], item["affected_text"].casefold()) not in existing
            )
            analysis_status = "complete" if not retrieval_note else "partial"
        except Exception:
            logger.exception("Gemini analysis failed for submission %s", submission.id)
            notes.append("Gemini analysis was unavailable; deterministic findings are shown.")
    elif settings.gemini_api_key:
        notes.append("Gemini analysis was skipped because no relevant approved evidence was retrieved.")
    else:
        notes.append("Gemini is not configured; deterministic checks only.")

    claim_evidence = [
        {
            "id": rule.id,
            "title": rule.title,
            "text": rule.rule_text,
            "guideline_id": rule.guideline_id,
            "source_section": rule.source_section,
            "source_page": rule.source_page,
            "source_type": "internal",
            "source_title": rule.guideline.title if rule.guideline else None,
            "created_at": (
                rule.guideline.created_at.isoformat()
                if rule.guideline and rule.guideline.created_at
                else None
            ),
        }
        for rule in rules
    ]
    claim_verifications = verify_claims_with_external_sources(
        submission.extracted_text, claim_evidence
    )
    for claim_result in claim_verifications:
        matched = [
            finding
            for finding in findings
            if finding["category"] == "unsupported_claim"
            and finding["affected_text"].casefold()
            in claim_result["claim_text"].casefold()
        ]
        if claim_result["status"] == "supported":
            findings = [finding for finding in findings if finding not in matched]
        elif claim_result["status"] == "contradicted" and matched:
            has_deterministic_rule_finding = any(
                finding["category"] == "prohibited_terminology"
                and finding["affected_text"].casefold()
                in claim_result["claim_text"].casefold()
                for finding in findings
            )
            if has_deterministic_rule_finding:
                findings = [finding for finding in findings if finding not in matched]
                continue
            for finding in matched:
                finding["evidence_status"] = "contradicted"
                finding["confidence"] = claim_result["confidence"]
                finding["explanation"] = claim_result["reason"]
                source = next(
                    (
                        item
                        for item in claim_result["evidence"]
                        if item.get("evidence_relation") == "contradicting"
                        or item.get("source_type") == "internal"
                    ),
                    None,
                )
                finding["source_rule"] = (
                    source
                    if source and source.get("source_type") != "external"
                    else None
                )
                finding["external_evidence_text"] = (
                    source.get("text")
                    if source and source.get("source_type") == "external"
                    else None
                )
        elif claim_result["status"] == "contradicted":
            if any(
                finding["category"] == "prohibited_terminology"
                and finding["affected_text"].casefold()
                in claim_result["claim_text"].casefold()
                for finding in findings
            ):
                continue
            source = next(
                (
                    item
                    for item in claim_result["evidence"]
                    if item.get("evidence_relation") == "contradicting"
                    or item.get("source_type") == "internal"
                ),
                None,
            )
            findings.append(
                {
                    "category": "unsupported_claim",
                    "affected_text": claim_result["claim_text"],
                    "explanation": claim_result["reason"],
                    "severity": "medium",
                    "confidence": claim_result["confidence"],
                    "evidence_status": "contradicted",
                    "source_rule": (
                        source
                        if source and source.get("source_type") != "external"
                        else None
                    ),
                    "external_evidence_text": (
                        source.get("text")
                        if source and source.get("source_type") == "external"
                        else None
                    ),
                    "suggested_correction": "Revise the claim or provide relevant, current evidence.",
                }
            )

    analysis = AnalysisResult(
        organization_id=user.organization_id,
        submission_id=submission.id,
        analyzed_by=user.id,
        compliance_score=_compliance_score(findings),
        analysis_status=analysis_status,
        score_formula=SCORE_FORMULA,
        analysis_note=" ".join(notes) or None,
    )
    db.add(analysis)
    db.flush()
    record_audit(db, user, "analysis.run", "analysis_result", analysis.id)
    persist_claim_verifications(
        db,
        user,
        claim_verifications,
        submission_id=submission.id,
        analysis_id=analysis.id,
    )
    for finding in findings:
        rule = finding["source_rule"]
        db.add(
            Violation(
                organization_id=user.organization_id,
                submission_id=submission.id,
                analysis_id=analysis.id,
                category=finding["category"],
                affected_text=finding["affected_text"],
                explanation=finding["explanation"],
                severity=finding["severity"],
                confidence=finding["confidence"],
                evidence_status=finding["evidence_status"],
                evidence_text=(
                    rule["text"] if isinstance(rule, dict) else rule.rule_text
                )
                if rule
                else finding.get("external_evidence_text"),
                source_guideline_id=(
                    rule["guideline_id"] if isinstance(rule, dict) else rule.guideline_id
                )
                if rule
                else None,
                source_rule_id=rule["id"] if isinstance(rule, dict) else rule.id if rule else None,
                source_section=rule["source_section"] if isinstance(rule, dict) else rule.source_section
                if rule
                else None,
                source_page=rule["source_page"] if isinstance(rule, dict) else rule.source_page
                if rule
                else None,
                suggested_correction=finding["suggested_correction"],
            )
        )
    submission.status = "analyzed"
    db.commit()
    db.refresh(analysis)
    return analysis


def serialize_analysis(db: Session, analysis: AnalysisResult) -> dict:
    findings = db.scalars(
        select(Violation)
        .where(
            Violation.analysis_id == analysis.id,
            Violation.organization_id == analysis.organization_id,
        )
        .order_by(Violation.created_at.asc())
    ).all()
    guideline_ids = {item.source_guideline_id for item in findings if item.source_guideline_id}
    guidelines = {
        guideline.id: guideline
        for guideline in db.scalars(
            select(BrandGuideline).where(
                BrandGuideline.organization_id == analysis.organization_id,
                BrandGuideline.id.in_(guideline_ids) if guideline_ids else False,
            )
        )
    }
    claim_records = db.scalars(
        select(ClaimVerificationRecord)
        .where(
            ClaimVerificationRecord.analysis_id == analysis.id,
            ClaimVerificationRecord.organization_id == analysis.organization_id,
        )
        .order_by(ClaimVerificationRecord.created_at.asc())
    ).all()
    visual_records = db.scalars(
        select(VisualAnalysisRecord)
        .where(
            VisualAnalysisRecord.submission_id == analysis.submission_id,
            VisualAnalysisRecord.organization_id == analysis.organization_id,
        )
        .order_by(VisualAnalysisRecord.created_at.asc())
    ).all()
    visual_analyses = []
    for record in visual_records:
        visual_report = json.loads(record.result_json)
        review_history = db.scalars(
            select(VisualReviewHistory)
            .where(
                VisualReviewHistory.visual_analysis_id == record.id,
                VisualReviewHistory.organization_id == analysis.organization_id,
            )
            .order_by(VisualReviewHistory.created_at.asc())
        ).all()
        visual_report.update(
            {
                "analysis_id": record.id,
                "asset_id": record.asset_id,
                "submission_id": record.submission_id,
                "review_status": record.review_status,
                "review_history": [
                    {
                        "decision": entry.decision,
                        "previous_status": entry.previous_status,
                        "new_status": entry.new_status,
                        "comment": entry.comment,
                        "created_at": entry.created_at,
                    }
                    for entry in review_history
                ],
            }
        )
        visual_analyses.append(visual_report)
    return {
        "id": analysis.id,
        "submission_id": analysis.submission_id,
        "compliance_score": analysis.compliance_score,
        "analysis_status": analysis.analysis_status,
        "analysis_note": analysis.analysis_note,
        "score_formula": analysis.score_formula,
        "created_at": analysis.created_at,
        "findings": [
            {
                "id": finding.id,
                "category": finding.category,
                "affected_text": finding.affected_text,
                "explanation": finding.explanation,
                "severity": finding.severity,
                "confidence": finding.confidence,
                "evidence_status": finding.evidence_status,
                "evidence_text": finding.evidence_text,
                "guideline_id": finding.source_guideline_id,
                "guideline_title": (
                    guidelines[finding.source_guideline_id].title
                    if finding.source_guideline_id in guidelines
                    else None
                ),
                "source_section": finding.source_section,
                "source_page": finding.source_page,
                "suggested_correction": finding.suggested_correction,
            }
            for finding in findings
        ],
        "claim_verifications": [
            serialize_claim_verification(db, record) for record in claim_records
        ],
        "visual_analyses": visual_analyses,
    }
