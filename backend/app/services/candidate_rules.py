import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import BrandGuideline, BrandRule, User

DIRECTIVE = re.compile(
    r"^(?:always|never|avoid|do not|don't|must|must not|use|prefer|include|required|ensure|keep|write|speak)\b",
    re.IGNORECASE,
)
SECTION = re.compile(r"^\[Section:\s*(.+?)\]$", re.IGNORECASE)
PAGE = re.compile(r"^\[Page\s+(\d+)\]$", re.IGNORECASE)
MAX_CANDIDATES = 30


def _category(text: str) -> str:
    lowered = text.casefold()
    if any(term in lowered for term in ("disclaimer", "disclosure", "results may vary")):
        return "required_disclaimers"
    if "tone" in lowered or "voice" in lowered:
        return "tone_of_voice"
    if any(term in lowered for term in ("claim", "guarantee", "proven", "promise")):
        return "marketing_claims"
    return "communication_guidelines"


def create_candidate_rules(
    db: Session,
    guideline: BrandGuideline,
    user: User,
) -> list[BrandRule]:
    existing = db.scalars(
        select(BrandRule.rule_text).where(
            BrandRule.organization_id == user.organization_id,
            BrandRule.guideline_id == guideline.id,
        )
    ).all()
    existing_text = {" ".join(text.casefold().split()) for text in existing}

    section = None
    page = None
    candidates = []
    seen = set(existing_text)
    for raw_line in guideline.extracted_text.splitlines():
        line = raw_line.strip()
        section_match = SECTION.fullmatch(line)
        if section_match:
            section = section_match.group(1).strip()[:200]
            continue
        page_match = PAGE.fullmatch(line)
        if page_match:
            page = int(page_match.group(1))
            continue
        if not line or len(line) > 500 or not DIRECTIVE.match(line):
            continue
        normalized = " ".join(line.casefold().split())
        if normalized in seen:
            continue
        seen.add(normalized)
        candidates.append(
            BrandRule(
                organization_id=user.organization_id,
                guideline_id=guideline.id,
                category=_category(line),
                title=line[:200],
                rule_text=line,
                source_section=section,
                source_page=page,
                approved=False,
                created_by=user.id,
            )
        )
        if len(candidates) == MAX_CANDIDATES:
            break
    return candidates
