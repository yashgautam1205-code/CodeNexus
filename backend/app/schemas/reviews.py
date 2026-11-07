from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewDecision(BaseModel):
    comment: str | None = Field(default=None, max_length=2000)


class ReviewRead(BaseModel):
    id: str
    submission_id: str
    reviewer_id: str
    decision: str
    previous_status: str
    new_status: str
    comment: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
