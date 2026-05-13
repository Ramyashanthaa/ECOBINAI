"""
Core waste classification service.
Orchestrates the full agentic loop:
  image → Gemma 4 vision → function call → hardware action → log event
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from backend.classifier.gemma_client import classify_image
from backend.config import settings

logger = logging.getLogger(__name__)

BIN_ACTION_MAP = {
    "OPEN_RECYCLABLE": "RECYCLABLE",
    "OPEN_COMPOST": "COMPOST",
    "OPEN_TRASH": "TRASH",
    "OPEN_HAZARDOUS": "HAZARDOUS",
}

CATEGORY_COLORS = {
    "RECYCLABLE": "#22c55e",
    "COMPOST": "#f97316",
    "TRASH": "#6b7280",
    "HAZARDOUS": "#ef4444",
    "HUMAN":     "#a78bfa",
    "PENDING":   "#facc15",
}

CATEGORY_ICONS = {
    "RECYCLABLE": "♻️",
    "COMPOST":    "🌱",
    "TRASH":      "🗑️",
    "HAZARDOUS":  "⚠️",
    "HUMAN":      "👤",
    "PENDING":    "❓",
}

# Education tips derived in Python — model no longer needs to generate these
EDUCATION_TIPS = {
    "RECYCLABLE": "Rinse containers before recycling to keep the stream uncontaminated.",
    "COMPOST":    "Composting diverts food waste from landfills and creates nutrient-rich soil.",
    "TRASH":      "When in doubt, throw it out — contamination ruins entire batches of recyclables.",
    "HAZARDOUS":  "Dispose of hazardous items at a certified collection point to protect the environment.",
    "HUMAN":      "",
    "PENDING":    "",
}


@dataclass
class ClassificationResult:
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
    unified_description: str = ""


def build_result_from_raw(
    raw: dict,
    controller=None,
    db_session=None,
    start_time: Optional[float] = None,
) -> ClassificationResult:
    """
    Build a ClassificationResult from an already-parsed model response dict.
    Handles hardware actuation and DB persistence.
    Separated from classify_waste so the streaming endpoint can reuse it.
    """
    if start_time is None:
        start_time = time.monotonic()
    elapsed_ms = int((time.monotonic() - start_time) * 1000)

    hazardous_bin_available = (
        settings.servo_pin_hazardous is not None and settings.servo_pin_hazardous > 0
    )

    category = raw.get("category", "TRASH")
    confidence = float(raw.get("confidence", 0.0))

    if confidence < 0.75 and category not in ("HUMAN", "PENDING"):
        original_category = category
        category = "TRASH"
        logger.info(f"Low confidence ({confidence:.1%}): overriding {original_category} → TRASH")

    # Derive bin_action from category if model didn't supply it
    default_bin_action = "NONE" if category in ("HUMAN", "PENDING") else f"OPEN_{category}"

    # Education tip is now Python-derived; override HAZARDOUS based on hardware
    education_tip = EDUCATION_TIPS.get(category, "")
    if category == "HAZARDOUS":
        education_tip = (
            "Place in the dedicated hazardous bin for safe disposal."
            if hazardous_bin_available
            else EDUCATION_TIPS["HAZARDOUS"]
        )

    result = ClassificationResult(
        item_identified=raw.get("item_identified", "Unknown item"),
        category=category,
        confidence=confidence,
        is_contaminated=bool(raw.get("is_contaminated", False)),
        contamination_details=raw.get("contamination_details", ""),
        reasoning=raw.get("reasoning", ""),
        bin_action=raw.get("bin_action", default_bin_action),
        education_tip=education_tip,
        color=CATEGORY_COLORS.get(category, "#6b7280"),
        icon=CATEGORY_ICONS.get(category, "🗑️"),
        timestamp=datetime.now(timezone.utc).isoformat(),
        processing_time_ms=elapsed_ms,
        pun=raw.get("pun", ""),
        appreciation_message=raw.get("appreciation_message", ""),
        needs_confirmation=bool(raw.get("needs_confirmation", False)),
        confirmation_question=raw.get("confirmation_question", ""),
    )

    # Build unified description
    if category == "HUMAN":
        result.unified_description = (
            result.pun or "Not quite waste! I sort waste, not humans."
        )
    elif category == "PENDING":
        result.unified_description = (
            result.confirmation_question or f"Is {result.item_identified} clean and empty?"
        )
    else:
        result.unified_description = (
            f"{result.item_identified} — {category.lower()} because {result.reasoning}"
        )

    if category in ("HUMAN", "PENDING"):
        return result

    # Hardware actuation
    bin_type = BIN_ACTION_MAP.get(result.bin_action, category)
    if controller:
        try:
            controller.open_lid(bin_type, duration=settings.lid_open_duration)
            logger.info(f"Lid opened: {bin_type} for {settings.lid_open_duration}s")
        except Exception as exc:
            logger.error(f"Hardware actuation failed: {exc}")

    # DB persistence
    if db_session:
        try:
            from backend.database.crud import create_waste_event
            create_waste_event(
                db=db_session,
                item_description=result.item_identified,
                category=result.category,
                confidence=result.confidence,
                is_contaminated=result.is_contaminated,
                bin_action=result.bin_action,
            )
        except Exception as exc:
            logger.error(f"DB write failed: {exc}")

    return result


def classify_waste(image_bytes: bytes, controller=None, db_session=None) -> ClassificationResult:
    """
    Full pipeline: classify image, actuate bin lid, persist event, return result.
    Always returns a result — never raises to the caller.
    """
    start = time.monotonic()

    try:
        raw = classify_image(image_bytes)
    except Exception as exc:
        logger.error(f"Image classification failed: {exc}", exc_info=True)
        return ClassificationResult(
            item_identified="Unable to analyze",
            category="TRASH",
            confidence=0.0,
            is_contaminated=False,
            contamination_details="",
            reasoning="Classification service temporarily unavailable. Please try again.",
            bin_action="NONE",
            education_tip="Check your internet connection and try uploading a clearer image.",
            color=CATEGORY_COLORS.get("TRASH", "#6b7280"),
            icon=CATEGORY_ICONS.get("TRASH", "🗑️"),
            timestamp=datetime.now(timezone.utc).isoformat(),
            processing_time_ms=int((time.monotonic() - start) * 1000),
            needs_confirmation=False,
            confirmation_question="",
            unified_description="Unable to analyze this image. Please try again with a clearer image.",
        )

    return build_result_from_raw(raw, controller, db_session, start)
