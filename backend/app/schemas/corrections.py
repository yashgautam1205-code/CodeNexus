from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class SuggestionRead(BaseModel):
    id: str
    violation_id: str
    original_text: str
    suggested_text: str
    decision: str
    generation_source: Literal["gemini", "deterministic", "fallback"] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
