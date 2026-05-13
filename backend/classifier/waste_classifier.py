"""
Core waste classification service.
Orchestrates the full agentic loop:
  image → Gemma 4 vision → function call → hardware action → log event
"""

import logging
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
    "RECYCLABLE": "#22c55e",   # green
    "COMPOST": "#f97316",      # orange
    "TRASH": "#6b7280",        # gray
    "HAZARDOUS": "#ef4444",    # red
    "HUMAN":     "#a78bfa",    # purple
    "PENDING":   "#facc15",    # yellow
}

CATEGORY_ICONS = {
    "RECYCLABLE": "♻️",
    "COMPOST":    "🌱",
    "TRASH":      "🗑️",
    "HAZARDOUS":  "⚠️",
    "HUMAN":      "👤",
    "PENDING":    "❓",
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
    unified_description: str = ""  # Merged summary: "Item - is a Category because reason"


def classify_waste(image_bytes: bytes, controller=None, db_session=None) -> ClassificationResult:
    """
    Full agentic pipeline:
    1. Send image to Gemma 4 (multimodal vision)
    2. Parse classification + bin action (native function call result)
    3. Actuate bin lid via controller (hardware or simulator)
    4. Persist event to database
    5. Return structured result for UI
    
    ROBUSTNESS: Always returns a result, never raises to 500
    """
    import time
    start = time.monotonic()

    # Determine if hazardous bin is available
    hazardous_bin_available = settings.servo_pin_hazardous is not None and settings.servo_pin_hazardous > 0

    try:
        raw = classify_image(image_bytes)
    except Exception as exc:
        logger.error(f"Image classification failed: {exc}", exc_info=True)
        # Return safe error result
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
            pun="",
            appreciation_message="No worries! Try again with a clearer image. 📸",
            needs_confirmation=False,
            confirmation_question="",
            unified_description="Unable to analyze this image. Please try again with a clearer image.",
        )

    elapsed_ms = int((time.monotonic() - start) * 1000)

    category = raw.get("category", "TRASH")
    confidence = float(raw.get("confidence", 0.0))
    
    # RULE: If confidence < 75%, classify as TRASH by default
    if confidence < 0.75 and category not in ("HUMAN", "PENDING"):
        original_category = category
        category = "TRASH"
        logger.info(f"Low confidence ({confidence:.1%}): overriding {original_category} → TRASH")
    
    result = ClassificationResult(
        item_identified=raw.get("item_identified", "Unknown item"),
        category=category,
        confidence=confidence,
        is_contaminated=bool(raw.get("is_contaminated", False)),
        contamination_details=raw.get("contamination_details", ""),
        reasoning=raw.get("reasoning", ""),
        bin_action=raw.get("bin_action", "NONE" if category in ("HUMAN", "PENDING") else f"OPEN_{category}"),
        education_tip=raw.get("education_tip", ""),
        color=CATEGORY_COLORS.get(category, "#6b7280"),
        icon=CATEGORY_ICONS.get(category, "🗑️"),
        timestamp=datetime.now(timezone.utc).isoformat(),
        processing_time_ms=elapsed_ms,
        pun=raw.get("pun", ""),
        appreciation_message=raw.get("appreciation_message", ""),
        needs_confirmation=bool(raw.get("needs_confirmation", False)),
        confirmation_question=raw.get("confirmation_question", ""),
    )

    # Set appropriate education tip for hazardous items based on bin availability
    if category == "HAZARDOUS":
        if hazardous_bin_available:
            result.education_tip = "Place in the dedicated hazardous bin for safe disposal."
        else:
            result.education_tip = "Dispose of hazardous waste at a certified collection point to protect the environment."

    # Build unified description for display
    if category == "HUMAN":
        result.unified_description = result.pun if result.pun else "Not quite waste! I sort waste, not humans."
    elif category == "PENDING":
        result.unified_description = result.confirmation_question if result.confirmation_question else f"Is {result.item_identified} clean and empty?"
    else:
        # Merge: "Item - is a Category because reasoning"
        category_display = category.lower()
        result.unified_description = f"{result.item_identified} - is a {category_display} because {result.reasoning}"

    # Skip hardware actuation and DB write for non-waste categories
    if category in ("HUMAN", "PENDING"):
        return result

    # Gemma 4 native function call → hardware actuation
    bin_type = BIN_ACTION_MAP.get(result.bin_action, category)
    if controller:
        try:
            controller.open_lid(bin_type, duration=settings.lid_open_duration)
            logger.info(f"Lid opened: {bin_type} for {settings.lid_open_duration}s")
        except Exception as exc:
            logger.error(f"Hardware actuation failed: {exc}")
            # Don't raise; continue to DB write

    # Persist to DB
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
            # Don't raise; return result anyway

    return result
