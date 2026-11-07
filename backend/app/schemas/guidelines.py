from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


RuleCategory = Literal[
    "tone_of_voice",
    "approved_terminology",
    "prohibited_terminology",
    "brand_messaging",
    "product_information",
    "marketing_claims",
    "communication_guidelines",
    "required_disclaimers",
]


class GuidelineRead(BaseModel):
    id: str
    filename: str
    title: str
    status: str
    version_number: int
    supersedes_guideline_id: str | None
    extracted_text: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class GuidelineUpdate(BaseModel):
    title: str = Field(min_length=2, max_length=200)


class RuleCreate(BaseModel):
    category: RuleCategory
    title: str = Field(min_length=2, max_length=200)
    rule_text: str = Field(min_length=2, max_length=5000)
    guideline_id: str | None = None
    term: str | None = Field(default=None, max_length=200)
    source_section: str | None = Field(default=None, max_length=200)
    source_page: int | None = Field(default=None, ge=1)
    replacement_text: str | None = Field(default=None, max_length=2000)


class RuleUpdate(BaseModel):
    category: RuleCategory | None = None
    title: str | None = Field(default=None, min_length=2, max_length=200)
    rule_text: str | None = Field(default=None, min_length=2, max_length=5000)
    guideline_id: str | None = None
    term: str | None = Field(default=None, max_length=200)
    source_section: str | None = Field(default=None, max_length=200)
    source_page: int | None = Field(default=None, ge=1)
    replacement_text: str | None = Field(default=None, max_length=2000)
    approved: bool | None = None


class RuleRead(BaseModel):
    id: str
    guideline_id: str | None
    term: str | None
    category: str
    title: str
    rule_text: str
    source_section: str | None
    source_page: int | None
    replacement_text: str | None
    approved: bool
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
