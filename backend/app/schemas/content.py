from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ContentRead(BaseModel):
    id: str
    filename: str
    extracted_text: str
    status: str
    review_status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
