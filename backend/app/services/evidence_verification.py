import re
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from app.core.config import settings
from app.services.external_search import ExternalSearchError, search_claim_sources

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "about", "after", "again", "also", "and", "are", "because", "been", "before",
    "being", "but", "can", "could", "does", "from", "have", "into", "more", "most",
    "not", "our", "over", "than", "that", "the", "their", "then", "there", "these",
    "they", "this", "those", "through", "under", "was", "were", "what", "when",
    "where", "which", "while", "with", "would", "your",
}
MAX_EXTRACTED_CLAIMS = 30
PROHIBITION_MARKERS = ("do not", "never", "avoid", "prohibited", "must not")
ASSERTIVE_CLAIM_TERMS = ("guaranteed", "#1", "100%", "zero risk", "best", "proven")

CLAIM_HINTS = (
    "guaranteed",
    "proven",
    "clinically proven",
    "100%",
    "zero risk",
    "best",
    "number one",
    "#1",
    "trusted by",
    "results may vary",
    "recommended",
    "approved",
)
STATISTICAL_PATTERN = re.compile(
    r"\b\d+(?:[.,]\d+)?\s*(?:percent\b|customers\b|people\b|times\b|x\b|(?=%))",
    re.IGNORECASE,
)
SUPERIORITY_TERMS = (
    "best",
    "number one",
    "#1",
    "leading",
    "fastest",
    "largest",
    "most effective",
    "superior",
)
PERFORMANCE_TERMS = (
    "guaranteed",
    "proven",
    "clinically proven",
    "zero risk",
    "results",
    "performance",
    "improve",
    "increase",
    "reduce",
    "save",
    "deliver",
    "supports",
    "provides",
    "helps",
)
FACTUAL_VERBS = (
    " is ",
    " are ",
    " was ",
    " were ",
    " has ",
    " have ",
    " contains ",
    " includes ",
    " operates ",
    " located ",
    " founded ",
    " certified ",
    " approved ",
)
SUBJECTIVE_TERMS = (
    "amazing",
    "beautiful",
    "brilliant",
    "delightful",
    "effortless",
    "exceptional",
    "inspiring",
    "unforgettable",
)
TIME_SENSITIVE_TERMS = (
    "today",
    "current",
    "currently",
    "latest",
    "recent",
    "right now",
    "as of",
    "this year",
    "this month",
    "current rate",
    "current price",
)


def _sentence_split(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]


def _normalize_date(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            pass
        for candidate in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(raw, candidate)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=timezone.utc)
                return parsed.astimezone(timezone.utc)
            except ValueError:
                continue
    return None


def source_credibility_score(item: dict[str, Any]) -> float:
    source_title = str(item.get("title") or item.get("source_title") or "").strip()
    source_url = str(item.get("url") or item.get("source_url") or "").strip()
    score = 0.5
    if source_title:
        score += 0.15
    if source_url:
        score += 0.15
    if item.get("published_at") or item.get("published_at_iso"):
        score += 0.1
    if item.get("guideline_id"):
        score += 0.1
    if item.get("source_type") == "user_supplied":
        return min(round(score, 2), 0.6)
    if item.get("source_type") == "external" and source_url:
        host = (urlsplit(source_url).hostname or "").lower().rstrip(".")
        if host.endswith(".gov") or host.endswith(".edu"):
            score += 0.15
        elif any(
            host == domain or host.endswith(f".{domain}")
            for domain in (
                "nih.gov",
                "who.int",
                "nature.com",
                "science.org",
            )
        ):
            score += 0.15
        elif host.endswith(".org"):
            score += 0.05
        if item.get("provider_relevance_score") is not None:
            score += max(0.0, min(0.1, float(item["provider_relevance_score"]) * 0.1))
        freshness_status = source_freshness_status(item)
        if freshness_status == "fresh":
            score += 0.05
        elif freshness_status in {"stale", "future_date"}:
            score -= 0.15
    return round(min(score, 1.0), 2)


def source_freshness_days(item: dict[str, Any]) -> int | None:
    published_at = _normalize_date(item.get("published_at") or item.get("published_at_iso") or item.get("created_at"))
    if published_at is None:
        return None
    age = (datetime.now(timezone.utc) - published_at).days
    return age if age >= 0 else None


def source_freshness_status(
    item: dict[str, Any],
    *,
    time_sensitive: bool = False,
) -> str:
    published_at = _normalize_date(
        item.get("published_at") or item.get("published_at_iso") or item.get("created_at")
    )
    if published_at is None:
        return "publication_date_unknown"
    age_days = (datetime.now(timezone.utc) - published_at).days
    if age_days < 0:
        return "future_date"
    maximum_age = (
        settings.time_sensitive_freshness_days
        if time_sensitive
        else settings.evidence_freshness_days
    )
    return "fresh" if age_days <= maximum_age else "stale"


def _claim_type(sentence: str) -> str:
    lowered = sentence.casefold()
    if STATISTICAL_PATTERN.search(lowered):
        return "statistical"
    if any(term in lowered for term in SUPERIORITY_TERMS):
        return "superiority"
    if any(term in lowered for term in PERFORMANCE_TERMS):
        return "product_performance"
    if any(term in lowered for term in FACTUAL_VERBS):
        return "objective_factual"
    return "subjective_marketing"


def _is_time_sensitive(sentence: str) -> bool:
    lowered = sentence.casefold()
    return any(term in lowered for term in TIME_SENSITIVE_TERMS) or bool(
        re.search(r"\b(?:in|during)\s+20\d{2}\b", lowered)
    )


def extract_claims(text: str) -> list[dict[str, Any]]:
    claims: list[dict[str, Any]] = []
    for index, sentence in enumerate(_sentence_split(text), start=1):
        if len(claims) >= MAX_EXTRACTED_CLAIMS:
            break
        lowered = sentence.casefold()
        if not sentence:
            continue
        claim_type = _claim_type(sentence)
        if (
            any(token in lowered for token in CLAIM_HINTS)
            or any(token in lowered for token in SUBJECTIVE_TERMS)
            or len(sentence.split()) >= 6
        ):
            claims.append(
                {
                    "id": f"claim-{index}",
                    "claim_text": sentence,
                    "claim_type": claim_type,
                    "time_sensitive": _is_time_sensitive(sentence),
                }
            )
    if not claims and text.strip():
        sentence = text.strip()
        claims.append(
            {
                "id": "claim-1",
                "claim_text": sentence,
                "claim_type": _claim_type(sentence),
                "time_sensitive": _is_time_sensitive(sentence),
            }
        )
    return claims


def _match_evidence(claim_text: str, evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for item in evidence:
        text = str(item.get("text") or item.get("rule_text") or "").strip()
        if text and _relevance_score(claim_text, text) >= 0.3:
            matches.append(item)
    return matches


def _is_prohibitive_internal_rule(item: dict[str, Any]) -> bool:
    if item.get("source_type", "internal") != "internal":
        return False
    rule_text = str(item.get("text") or item.get("rule_text") or "").casefold()
    return any(marker in rule_text for marker in PROHIBITION_MARKERS)


def verify_claims(text: str, evidence: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    evidence = evidence or []
    findings: list[dict[str, Any]] = []
    for claim in extract_claims(text):
        claim_text = claim["claim_text"]
        normalized = claim_text.casefold()
        if claim["claim_type"] == "subjective_marketing":
            findings.append(
                {
                    **claim,
                    "status": "needs_review",
                    "confidence": 0.35,
                    "evidence": [],
                    "reason": "Subjective marketing language is not objectively verifiable from sources.",
                }
            )
            continue
        matches = _match_evidence(claim_text, evidence)
        supporting = [
            item
            for item in matches
            if source_credibility_score(item) >= 0.7
            and not _is_prohibitive_internal_rule(item)
        ]
        contradicting = []
        for item in evidence:
            value = str(item.get("text") or item.get("rule_text") or "").strip()
            normalized_rule = value.casefold()
            if _is_prohibitive_internal_rule(item) and any(
                term in normalized and term in normalized_rule
                for term in ASSERTIVE_CLAIM_TERMS
            ):
                contradicting.append(item)
        if contradicting:
            status = "contradicted"
            reason = "The claim is contradicted by a higher-confidence approved rule or source."
        elif supporting:
            status = "supported"
            reason = "The claim matches approved evidence and the source is sufficiently credible."
        elif any(token in normalized for token in ("guaranteed", "proven", "100%", "zero risk", "#1")):
            status = "insufficient_evidence"
            reason = "This claim includes a strong assertion but no matching supporting evidence was found."
        elif evidence:
            status = "needs_review"
            reason = "Relevant evidence exists, but it does not directly support the claim with sufficient credibility."
        else:
            status = "insufficient_evidence"
            reason = "No source evidence was supplied for this claim."
        item_details = []
        seen_evidence = set()
        for item in supporting + contradicting + matches:
            identity = (
                item.get("id"),
                item.get("guideline_id"),
                item.get("url") or item.get("source_url"),
                item.get("title") or item.get("source_title"),
                item.get("text") or item.get("rule_text"),
            )
            if identity in seen_evidence:
                continue
            seen_evidence.add(identity)
            item_details.append(
                {
                    "id": item.get("id") or item.get("guideline_id"),
                    "title": item.get("title") or item.get("source_title"),
                    "text": item.get("text") or item.get("rule_text"),
                    "source_section": item.get("source_section"),
                    "source_page": item.get("source_page"),
                    "guideline_id": item.get("guideline_id"),
                    "source_url": item.get("url") or item.get("source_url"),
                    "source_type": item.get("source_type", "internal"),
                    "published_at": item.get("published_at") or item.get("published_at_iso") or item.get("created_at"),
                    "retrieved_at": item.get("retrieved_at"),
                    "credibility_score": source_credibility_score(item),
                    "freshness_days": source_freshness_days(item),
                    "relevance_score": item.get("relevance_score"),
                    "citation_valid": item.get("citation_valid"),
                    "publisher_domain": item.get("publisher_domain"),
                    "freshness_status": source_freshness_status(
                        item, time_sensitive=claim["time_sensitive"]
                    ),
                }
            )
        findings.append(
            {
                "id": claim["id"],
                "claim_text": claim_text,
                "claim_type": claim["claim_type"],
                "time_sensitive": claim["time_sensitive"],
                "status": status,
                "confidence": 0.9 if status == "supported" else 0.75 if status == "contradicted" else 0.65,
                "evidence": item_details,
                "reason": reason,
            }
        )
    return findings


def _relevance_score(claim_text: str, source_text: str) -> float:
    claim_terms = {
        token for token in re.findall(r"\b[a-zA-Z][a-zA-Z0-9_-]{2,}\b", claim_text.casefold())
        if token not in STOP_WORDS
    }
    if not claim_terms:
        return 0.0
    source_terms = set(
        re.findall(r"\b[a-zA-Z][a-zA-Z0-9_-]{2,}\b", source_text.casefold())
    )
    return round(len(claim_terms & source_terms) / len(claim_terms), 3)


def verify_claims_with_external_sources(
    text: str,
    internal_evidence: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    internal_evidence = internal_evidence or []
    internal_results = verify_claims(text, internal_evidence)
    findings: list[dict[str, Any]] = []
    for index, claim in enumerate(extract_claims(text)):
        internal = internal_results[index]
        provider_status = "not_attempted"
        assessment_status = "not_attempted"
        retrieval_timestamp = None
        external_sources: list[dict[str, Any]] = []
        assessment_error_type = None
        assessment_error_code = None
        if claim["claim_type"] == "subjective_marketing":
            provider_status = "not_applicable"
            assessment_status = "not_applicable"
        elif index < settings.external_claim_limit:
            try:
                retrieval = search_claim_sources(claim["claim_text"])
                provider_status = retrieval["status"]
                retrieval_timestamp = retrieval.get("retrieved_at")
                external_sources = retrieval["sources"]
            except ExternalSearchError:
                provider_status = "unavailable"
        else:
            provider_status = "claim_limit_reached"

        for source in external_sources:
            source["relevance_score"] = _relevance_score(
                claim["claim_text"], source["text"]
            )
            source["freshness_days"] = source_freshness_days(source)
            source["freshness_status"] = source_freshness_status(
                source, time_sensitive=claim["time_sensitive"]
            )
            source["credibility_score"] = source_credibility_score(source)

        external_assessment = None
        if external_sources and settings.gemini_api_key:
            try:
                from app.ai.gemini import assess_claim_with_gemini

                assessment_candidates = sorted(
                    external_sources,
                    key=lambda source: (
                        source["relevance_score"],
                        source["credibility_score"],
                    ),
                    reverse=True,
                )[:3]
                external_assessment = assess_claim_with_gemini(
                    claim["claim_text"],
                    [
                        {
                            key: source.get(key)
                            for key in (
                                "id",
                                "title",
                                "source_url",
                                "publisher_domain",
                                "published_at",
                                "relevance_score",
                                "credibility_score",
                                "text",
                            )
                            if source.get(key) is not None
                        }
                        | {"text": source["text"][:2400]}
                        for source in assessment_candidates
                    ],
                )
                assessment_status = "available"
            except Exception as exc:
                assessment_error_type = type(exc).__name__
                error_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
                assessment_error_code = error_code if isinstance(error_code, int) else None
                logger.warning(
                    "External evidence assessment unavailable claim_id=%s error_type=%s status_code=%s",
                    claim["id"],
                    assessment_error_type,
                    assessment_error_code,
                )
                assessment_status = "unavailable"
        elif external_sources:
            assessment_status = "not_configured"

        valid_source_ids = {source["id"] for source in external_sources}
        supporting_ids: set[str] = set()
        contradicting_ids: set[str] = set()
        model_confidence = 0.0
        assessment_rationale = None
        assessment_source_ids: list[str] = []
        assessment_model = None
        if external_assessment is not None:
            relevant_source_ids = {
                source["id"]
                for source in external_sources
                if source["relevance_score"] >= 0.1
                and source["credibility_score"] >= 0.6
                and (
                    not claim["time_sensitive"]
                    or source["freshness_status"] == "fresh"
                )
            }
            supporting_ids = (
                set(external_assessment.supporting_source_ids)
                & valid_source_ids
                & relevant_source_ids
            )
            contradicting_ids = (
                set(external_assessment.contradicting_source_ids)
                & valid_source_ids
                & relevant_source_ids
            )
            model_confidence = external_assessment.confidence
            assessment_source_ids = sorted(supporting_ids | contradicting_ids)
            if assessment_source_ids:
                rationale = str(external_assessment.rationale).strip()
                assessment_rationale = rationale[:1000] if rationale else None
            assessment_model = (
                getattr(external_assessment, "_model_used", None)
                or settings.gemini_model
            )

        external_details = []
        for source in external_sources:
            source_id = source["id"]
            if source_id in supporting_ids and source_id in contradicting_ids:
                relation = "conflicting"
            elif source_id in supporting_ids:
                relation = "supporting"
            elif source_id in contradicting_ids:
                relation = "contradicting"
            else:
                relation = "unassessed"
            external_details.append({**source, "evidence_relation": relation})
        evidence_details = internal["evidence"] + external_details

        status = internal["status"]
        confidence = internal["confidence"]
        reason = internal["reason"]
        if internal["status"] not in {"contradicted", "supported"}:
            if supporting_ids and contradicting_ids:
                status = "needs_review"
                confidence = min(model_confidence, 0.7)
                reason = "Retrieved sources provide conflicting signals; human review is required."
            elif model_confidence >= 0.75 and contradicting_ids:
                status = "contradicted"
                confidence = model_confidence
                reason = "Relevant retrieved source content contradicts the claim."
            elif model_confidence >= 0.75 and supporting_ids:
                status = "supported"
                confidence = model_confidence
                reason = "Relevant retrieved source content supports the claim."
            elif provider_status == "results_found":
                status = "needs_review"
                confidence = 0.5
                reason = (
                    "Sources were retrieved, but no configured assessment validated them as direct support or contradiction."
                    if assessment_status != "available"
                    else "Sources were retrieved but could not be validated as relevant support or contradiction."
                )
            elif provider_status == "no_results" and not internal["evidence"]:
                status = "insufficient_evidence"
                confidence = 0.5
                reason = "External search returned no relevant sources; this does not establish that the claim is false."
            elif provider_status in {"missing_credentials", "unavailable", "not_configured"}:
                status = "needs_review"
                confidence = 0.5
                reason = "External source retrieval was unavailable; the claim remains unverified."

        last_verified_at = retrieval_timestamp
        if last_verified_at is None and provider_status in {
            "no_results",
            "results_found",
            "missing_credentials",
            "unavailable",
            "not_configured",
        }:
            last_verified_at = datetime.now(timezone.utc).isoformat()
        findings.append(
            {
                **internal,
                "status": status,
                "confidence": confidence,
                "evidence": evidence_details,
                "provider_status": provider_status,
                "assessment_status": assessment_status,
                "assessment_model": assessment_model,
                "assessment_rationale": assessment_rationale,
                "assessment_source_ids": assessment_source_ids,
                "assessment_error_type": assessment_error_type,
                "assessment_error_code": assessment_error_code,
                "retrieval_timestamp": retrieval_timestamp,
                "last_verified_at": last_verified_at,
                "reason": reason,
            }
        )
    return findings
