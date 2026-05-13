from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from backend.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite only
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


class WasteEvent(Base):
    __tablename__ = "waste_events"

    id = Column(Integer, primary_key=True, index=True)
    item_description = Column(String, nullable=False)
    category = Column(String, nullable=False)          # RECYCLABLE / COMPOST / TRASH / HAZARDOUS
    confidence = Column(Float, nullable=False)
    is_contaminated = Column(Boolean, default=False)
    bin_action = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


def create_tables():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
