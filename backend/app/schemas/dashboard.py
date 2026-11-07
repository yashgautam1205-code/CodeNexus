from pydantic import BaseModel


class DashboardOverview(BaseModel):
    total_submissions: int
    analyzed_submissions: int
    pending_reviews: int
    approved_content: int
    rejected_content: int
    total_violations: int
    severity_distribution: dict[str, int]
    compliance_trend: list[dict]
    recent_activities: list[dict]
