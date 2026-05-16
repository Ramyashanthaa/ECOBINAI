from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.api.schemas import ImpactResponse, StatsResponse, WasteEventOut
from backend.database.crud import (
    get_category_stats,
    get_contamination_rate,
    get_impact_stats,
    get_recent_events,
    get_total_events,
)
from backend.database.models import get_db

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/", response_model=StatsResponse)
def get_stats(db: Session = Depends(get_db)):
    """Aggregated waste disposal statistics for the dashboard."""
    total = get_total_events(db)
    counts = get_category_stats(db)
    contamination_rate = get_contamination_rate(db)

    def pct(cat: str) -> float:
        if total == 0:
            return 0.0
        return round(counts.get(cat, 0) / total * 100, 1)

    return StatsResponse(
        total_items=total,
        category_counts=counts,
        contamination_rate=contamination_rate,
        recyclable_pct=pct("RECYCLABLE"),
        compost_pct=pct("COMPOST"),
        trash_pct=pct("TRASH"),
        hazardous_pct=pct("HAZARDOUS"),
    )


@router.get("/impact", response_model=ImpactResponse)
def get_impact(db: Session = Depends(get_db)):
    """Running environmental impact totals derived from classified items."""
    return ImpactResponse(**get_impact_stats(db))


@router.get("/recent", response_model=list[WasteEventOut])
def get_recent(limit: int = 20, db: Session = Depends(get_db)):
    """Recent waste classification events."""
    events = get_recent_events(db, limit=limit)
    return [
        WasteEventOut(
            id=e.id,
            item_description=e.item_description,
            category=e.category,
            confidence=e.confidence,
            is_contaminated=e.is_contaminated,
            bin_action=e.bin_action,
            created_at=e.created_at.isoformat() if e.created_at else "",
        )
        for e in events
    ]
