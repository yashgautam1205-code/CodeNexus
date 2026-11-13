from datetime import datetime
from typing import Literal

from pydantic import BaseModel


ReviewResourceType = Literal["content", "visual", "claim"]
ReviewAssignmentStatus = Literal["pending", "completed", "cancelled"]


class ReviewAssignmentCreate(BaseModel):
    resource_type: ReviewResourceType
    resource_id: str
    reviewer_id: str


class ReviewAssignmentRead(BaseModel):
    id: str
    resource_type: ReviewResourceType
    resource_id: str
    resource_name: str
    reviewer_id: str
    reviewer_name: str
    assigned_by: str
    status: ReviewAssignmentStatus
    assigned_at: datetime
    completed_at: datetime | None
