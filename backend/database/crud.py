from sqlalchemy.orm import Session
from sqlalchemy import func, desc

from backend.database.models import WasteEvent


def create_waste_event(
    db: Session,
    item_description: str,
    category: str,
    confidence: float,
    is_contaminated: bool,
    bin_action: str,
) -> WasteEvent:
    event = WasteEvent(
        item_description=item_description,
        category=category,
        confidence=confidence,
        is_contaminated=is_contaminated,
        bin_action=bin_action,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def get_recent_events(db: Session, limit: int = 20) -> list[WasteEvent]:
    return (
        db.query(WasteEvent)
        .order_by(desc(WasteEvent.created_at))
        .limit(limit)
        .all()
    )


def get_category_stats(db: Session) -> dict:
    rows = (
        db.query(WasteEvent.category, func.count(WasteEvent.id))
        .group_by(WasteEvent.category)
        .all()
    )
    return {row[0]: row[1] for row in rows}


def get_contamination_rate(db: Session) -> float:
    total = db.query(func.count(WasteEvent.id)).scalar() or 0
    if total == 0:
        return 0.0
    contaminated = (
        db.query(func.count(WasteEvent.id))
        .filter(WasteEvent.is_contaminated.is_(True))
        .scalar()
        or 0
    )
    return round(contaminated / total, 4)


def get_total_events(db: Session) -> int:
    return db.query(func.count(WasteEvent.id)).scalar() or 0
