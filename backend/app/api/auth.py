import logging
from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, require_roles
from app.core.rate_limit import limit_login_attempts, limit_registration_attempts
from app.core.security import create_access_token, hash_password, verify_password
from app.database.session import get_db
from app.models.entities import Organization, User, UserRole
from app.schemas.auth import AuthResponse, LoginRequest, RegisterRequest, UserCreate, UserRead
from app.services.audit import record_audit

router = APIRouter(prefix="/api/auth", tags=["authentication"])
logger = logging.getLogger(__name__)


def user_response(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        organization_id=user.organization_id,
        organization_name=user.organization.name,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_registration_attempts)],
)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    organization = Organization(name=payload.organization_name.strip())
    user = User(
        organization=organization,
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=UserRole.ADMIN.value,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(access_token=create_access_token(user.id), user=user_response(user))


@router.post(
    "/login",
    response_model=AuthResponse,
    dependencies=[Depends(limit_login_attempts)],
)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    started_at = perf_counter()
    logger.info("event=login_started")

    query_started_at = perf_counter()
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    logger.info(
        "event=login_user_query_completed duration_ms=%d",
        round((perf_counter() - query_started_at) * 1000),
    )
    if user is None:
        logger.info("event=login_rejected reason=invalid_credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    verification_started_at = perf_counter()
    password_matches = verify_password(payload.password, user.password_hash)
    logger.info(
        "event=login_password_verification_completed duration_ms=%d",
        round((perf_counter() - verification_started_at) * 1000),
    )
    if not password_matches or not user.is_active:
        logger.info("event=login_rejected reason=invalid_credentials")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    response = AuthResponse(
        access_token=create_access_token(user.id),
        user=user_response(user),
    )
    logger.info(
        "event=login_succeeded duration_ms=%d",
        round((perf_counter() - started_at) * 1000),
    )
    return response


@router.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user_response(user)


@router.get("/users", response_model=list[UserRead])
def list_users(
    user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    users = db.scalars(
        select(User)
        .where(User.organization_id == user.organization_id)
        .order_by(User.created_at.asc())
    ).all()
    return [user_response(item) for item in users]


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    admin: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    email = payload.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")
    user = User(
        organization_id=admin.organization_id,
        email=email,
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    record_audit(db, admin, "user.create", "user", user.id)
    db.commit()
    db.refresh(user)
    return user_response(user)
