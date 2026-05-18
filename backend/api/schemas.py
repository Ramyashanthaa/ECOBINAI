from pydantic import BaseModel, Field
from typing import Optional


class ClassificationResponse(BaseModel):
    item_identified: str
    category: str
    confidence: float
    is_contaminated: bool
    contamination_details: str
    reasoning: str
    bin_action: str
    education_tip: str
    color: str
    icon: str
    timestamp: str
    processing_time_ms: int
    pun: str = ""
    appreciation_message: str = ""
    needs_confirmation: bool = False
    confirmation_question: str = ""
    yes_category: str = ""
    no_category: str = ""
    unified_description: str = ""  # Merged summary for UI display
    donatable: bool = False
    donation_suggestion: str = ""


class ImpactResponse(BaseModel):
    items_sorted: int
    co2_diverted_kg: float
    recyclables_saved: int
    compost_diverted: int


class WasteEventOut(BaseModel):
    id: int
    item_description: str
    category: str
    confidence: float
    is_contaminated: bool
    bin_action: str
    created_at: str

    model_config = {"from_attributes": True}


class StatsResponse(BaseModel):
    total_items: int
    category_counts: dict[str, int]
    contamination_rate: float
    recyclable_pct: float
    compost_pct: float
    trash_pct: float
    hazardous_pct: float


class LidStateResponse(BaseModel):
    RECYCLABLE: bool
    COMPOST: bool
    TRASH: bool
    HAZARDOUS: bool


class HealthResponse(BaseModel):
    status: str
    backend: str
    model: str
    hardware_mode: bool
    usb_camera_enabled: bool = False
    version: str = "1.0.0"
