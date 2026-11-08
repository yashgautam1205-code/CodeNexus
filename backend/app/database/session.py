from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine_options = {
    "pool_pre_ping": True,
    "echo": settings.sqlalchemy_echo,
}
if settings.database_url.startswith("postgresql+psycopg://"):
    engine_options.update(
        connect_args={"connect_timeout": 5},
        pool_timeout=5,
    )

engine = create_engine(
    settings.database_url,
    connect_args=connect_args,
    **engine_options,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
