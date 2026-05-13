import asyncio
import logging
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from backend.api.schemas import ClassificationResponse, LidStateResponse
from backend.classifier.waste_classifier import classify_waste
from backend.database.models import get_db
from backend.hardware.simulator import get_lid_states, subscribe, unsubscribe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/classify", tags=["classify"])

# Shared controller instance (injected at app startup)
_controller = None


def set_controller(controller) -> None:
    global _controller
    _controller = controller


@router.post("/image", response_model=ClassificationResponse)
async def classify_image_endpoint(
    file: UploadFile = File(..., description="Image of the waste item (JPEG/PNG)"),
    db: Session = Depends(get_db),
):
    """
    Core endpoint: receive an image, run Gemma 4 multimodal classification,
    actuate the correct bin lid, persist the event, return structured result.
    """
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Unsupported image format. Use JPEG or PNG.")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10 MB guard
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    try:
        # Run the blocking Gemma API call in a thread pool so the asyncio
        # event loop (and WebSocket broadcaster) stay responsive during inference.
        result = await asyncio.to_thread(
            classify_waste, image_bytes, _controller, db
        )
    except Exception as exc:
        logger.error(f"Classification failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Classification error: {str(exc)}")

    return ClassificationResponse(
        item_identified=result.item_identified,
        category=result.category,
        confidence=result.confidence,
        is_contaminated=result.is_contaminated,
        contamination_details=result.contamination_details,
        reasoning=result.reasoning,
        bin_action=result.bin_action,
        education_tip=result.education_tip,
        color=result.color,
        icon=result.icon,
        timestamp=result.timestamp,
        processing_time_ms=result.processing_time_ms,
        pun=result.pun,
        appreciation_message=result.appreciation_message,
        needs_confirmation=result.needs_confirmation,
        confirmation_question=result.confirmation_question,
    )


@router.get("/lid-states", response_model=LidStateResponse)
def get_current_lid_states():
    """Returns which bin lids are currently open."""
    states = get_lid_states()
    return LidStateResponse(**states)


@router.websocket("/ws/lid-states")
async def lid_states_websocket(websocket: WebSocket):
    """
    WebSocket stream of lid state change events.
    Dashboard connects here to animate bin lids in real time.
    """
    await websocket.accept()
    queue = subscribe()
    try:
        # Send current state on connect
        await websocket.send_json({"type": "init", "states": get_lid_states()})
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe(queue)
