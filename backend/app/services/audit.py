from sqlalchemy.orm import Session

from app.models.entities import AuditLog, User


def record_audit(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    entity_id: str,
) -> None:
    db.add(
        AuditLog(
            organization_id=user.organization_id,
            actor_id=user.id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
        )
    )
