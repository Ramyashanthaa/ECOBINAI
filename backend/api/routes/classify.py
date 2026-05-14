import asyncio
import dataclasses
import json
import logging
import re
import threading

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from backend.api.schemas import ClassificationResponse, LidStateResponse
from backend.classifier.waste_classifier import (
    classify_waste,
    build_result_from_raw,
    CATEGORY_COLORS,
    CATEGORY_ICONS,
)
from backend.database.models import get_db
from backend.hardware.simulator import get_lid_states, subscribe, unsubscribe

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/classify", tags=["classify"])

_controller = None


def set_controller(controller) -> None:
    global _controller
    _controller = controller


# ── Standard (non-streaming) endpoint ────────────────────────────────────────

@router.post("/image", response_model=ClassificationResponse)
async def classify_image_endpoint(
    file: UploadFile = File(..., description="Image of the waste item (JPEG/PNG)"),
    db: Session = Depends(get_db),
):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Unsupported image format. Use JPEG or PNG.")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    try:
        result = await asyncio.to_thread(classify_waste, image_bytes, _controller, db)
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
        unified_description=result.unified_description,
    )


# ── Streaming SSE endpoint ────────────────────────────────────────────────────

@router.post("/image/stream")
async def classify_image_stream_endpoint(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    SSE endpoint for streaming classification.

    Emits three event types:
      {"status": "analyzing"}                        — immediately on receipt
      {"status": "partial", "category": ..., ...}   — as soon as category is detected
      {"status": "complete", "result": {...}}        — full result when model finishes
    """
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Unsupported image format.")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")

    async def event_stream():
        import time
        start_time = time.monotonic()

        # Immediately acknowledge receipt so the UI can switch to "analyzing" state
        yield f"data: {json.dumps({'status': 'analyzing'})}\n\n"

        token_queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def run_stream_in_thread():
            try:
                from backend.classifier.gemma_client import classify_image_stream
                for token in classify_image_stream(image_bytes):
                    loop.call_soon_threadsafe(token_queue.put_nowait, ("token", token))
            except Exception as exc:
                loop.call_soon_threadsafe(token_queue.put_nowait, ("error", str(exc)))
            finally:
                loop.call_soon_threadsafe(token_queue.put_nowait, ("done", None))

        thread = threading.Thread(target=run_stream_in_thread, daemon=True)
        thread.start()

        accumulated = ""
        partial_sent = False

        while True:
            kind, value = await token_queue.get()

            if kind == "error":
                yield f"data: {json.dumps({'status': 'error', 'message': value})}\n\n"
                return

            if kind == "done":
                break

            accumulated += value

            # Emit a partial event the moment we can identify category + item.
            # This lets the frontend show the colored result card immediately.
            if not partial_sent:
                cat_m = re.search(r'"category"\s*:\s*"([A-Z]+)"', accumulated)
                if cat_m:
                    partial_sent = True
                    category = cat_m.group(1)
                    item_m = re.search(r'"item_identified"\s*:\s*"([^"]+)"', accumulated)
                    item = item_m.group(1) if item_m else "Analyzing…"
                    yield f"data: {json.dumps({'status': 'partial', 'category': category, 'item_identified': item, 'color': CATEGORY_COLORS.get(category, '#6b7280'), 'icon': CATEGORY_ICONS.get(category, '🗑️')})}\n\n"

        # Parse the accumulated response into a full result
        try:
            from backend.classifier.gemma_client import _extract_json, _validate_result, _store_cached, _safe_fallback
            raw = _extract_json(accumulated)
            _validate_result(raw)
            _store_cached(image_bytes, raw)
        except Exception as exc:
            logger.warning(f"Stream parse failed ({exc}); using fallback")
            from backend.classifier.gemma_client import _safe_fallback
            raw = _safe_fallback(str(exc))

        result = await asyncio.to_thread(
            build_result_from_raw, raw, _controller, db, start_time
        )

        yield f"data: {json.dumps({'status': 'complete', 'result': dataclasses.asdict(result)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ── Lid state endpoints ───────────────────────────────────────────────────────

@router.get("/lid-states", response_model=LidStateResponse)
def get_current_lid_states():
    states = get_lid_states()
    return LidStateResponse(**states)


@router.websocket("/ws/lid-states")
async def lid_states_websocket(websocket: WebSocket):
    await websocket.accept()
    queue = subscribe()
    try:
        await websocket.send_json({"type": "init", "states": get_lid_states()})
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe(queue)
