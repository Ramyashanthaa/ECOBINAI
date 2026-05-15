"""
Gemma 4 client — supports three backends:
  1. google_ai_studio  (default, free API key, best for demo)
  2. ollama            (local / edge / fully offline)
  3. huggingface       (self-hosted, required for fine-tuned weights)
"""

import base64
import hashlib
import io
import json
import logging
import re
import threading
from typing import Generator

import httpx

from backend.config import settings
from backend.classifier.prompts import SYSTEM_PROMPT, USER_CLASSIFICATION_PROMPT

logger = logging.getLogger(__name__)

# Pre-computed once — avoids rebuilding the string on every request
_COMBINED_PROMPT = f"{SYSTEM_PROMPT}\n\n{USER_CLASSIFICATION_PROMPT}"

# ── Client caches (initialized once at first use / warmup, reused after) ─────
_google_client = None
_hf_model = None
_hf_processor = None
_model_lock = threading.Lock()

# Persistent HTTP client — connection pool is reused across Ollama requests
_ollama_client = httpx.Client(timeout=120.0)

# Image-hash result cache — avoids re-classifying identical frames
_result_cache: dict[str, dict] = {}
_CACHE_SIZE = 50

# Token budget for Google AI: new SDK sends image as raw bytes (not PIL),
# which avoids the 500 errors caused by the old SDK's image serialization.
# With the new SDK the model responds with compact JSON directly (~300 chars).
_MAX_OUTPUT_TOKENS = 2048


def _optimize_image(image_bytes: bytes, max_size: int = 512) -> bytes:
    try:
        import PIL.Image
        img = PIL.Image.open(io.BytesIO(image_bytes)).convert("RGB")
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), PIL.Image.Resampling.LANCZOS)
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=85, optimize=True)
        optimized = output.getvalue()
        return optimized if len(optimized) < len(image_bytes) else image_bytes
    except Exception as e:
        logger.warning(f"Image optimization failed ({e}), using original")
        return image_bytes


def _image_to_base64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def _extract_json(text: str) -> dict:
    """
    Pull the best JSON object from model output.
    1. Try markdown fences first
    2. Greedy extraction (first { to last }) — correct for flat single-object JSON
    3. Try all non-nested {} blocks (last valid one wins)
    4. Fall back to parsing the whole text
    """
    text = text.strip()

    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Greedy: span from first { to last } — handles thinking text before JSON
    start = text.find("{")
    end = text.rfind("}") + 1
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    # Non-nested blocks (handles multiple small {} in output; try last first)
    for m in reversed(list(re.finditer(r"\{[^{}]*\}", text))):
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            continue

    return json.loads(text)


# ── Google AI Studio backend (google-genai SDK) ───────────────────────────────

def _get_google_client():
    global _google_client
    if _google_client is None:
        with _model_lock:
            if _google_client is None:
                try:
                    import google.genai as genai
                except ImportError:
                    raise RuntimeError(
                        "google-genai not installed. Run: pip install google-genai pillow"
                    )
                _google_client = genai.Client(api_key=settings.google_ai_api_key)
                logger.info(f"Google AI client initialised (model={settings.gemma_model})")
    return _google_client


def _classify_google_ai(image_bytes: bytes) -> dict:
    try:
        from google.genai import types
    except ImportError:
        raise RuntimeError("google-genai not installed. Run: pip install google-genai pillow")

    client = _get_google_client()
    optimized_bytes = _optimize_image(image_bytes)

    # Send image as raw JPEG bytes with explicit MIME type.
    # The old PIL-object approach caused 500 errors due to implicit PNG encoding.
    image_part = types.Part.from_bytes(data=optimized_bytes, mime_type="image/jpeg")
    cfg = types.GenerateContentConfig(max_output_tokens=_MAX_OUTPUT_TOKENS, temperature=0.0)

    # Try configured model first, then the alternate Gemma 4 variant, then Gemini fallback.
    # Gemma 4 models sometimes have service outages; Gemini 2.5 Flash is always available.
    model_chain = [
        settings.gemma_model,
        "gemma-4-26b-a4b-it" if "31b" in settings.gemma_model else "gemma-4-31b-it",
        "gemini-2.5-flash",
    ]
    # Deduplicate while preserving order
    seen: set[str] = set()
    models_to_try = [m for m in model_chain if not (m in seen or seen.add(m))]  # type: ignore[func-returns-value]

    last_exc: Exception | None = None
    for model_name in models_to_try:
        try:
            logger.info(f"Trying model: {model_name}")
            response = client.models.generate_content(
                model=model_name,
                contents=[image_part, _COMBINED_PROMPT],
                config=cfg,
            )
            if not response.candidates:
                raise ValueError("No candidates in response (possibly safety-filtered)")
            result = _extract_json(response.text)
            if model_name != settings.gemma_model:
                logger.info(f"Used fallback model: {model_name}")
            return result
        except Exception as exc:
            last_exc = exc
            logger.warning(f"Model {model_name} failed: {type(exc).__name__}: {str(exc)[:120]}")
    raise last_exc  # type: ignore[misc]


def _stream_google_ai(image_bytes: bytes) -> Generator[str, None, None]:
    try:
        from google.genai import types
    except ImportError:
        raise RuntimeError("google-genai not installed. Run: pip install google-genai pillow")

    client = _get_google_client()
    optimized_bytes = _optimize_image(image_bytes)
    image_part = types.Part.from_bytes(data=optimized_bytes, mime_type="image/jpeg")
    cfg = types.GenerateContentConfig(max_output_tokens=_MAX_OUTPUT_TOKENS, temperature=0.0)

    model_chain = [
        settings.gemma_model,
        "gemma-4-26b-a4b-it" if "31b" in settings.gemma_model else "gemma-4-31b-it",
        "gemini-2.5-flash",
    ]
    seen: set[str] = set()
    models_to_try = [m for m in model_chain if not (m in seen or seen.add(m))]  # type: ignore[func-returns-value]

    for model_name in models_to_try:
        try:
            logger.info(f"Streaming with model: {model_name}")
            yielded = False
            for chunk in client.models.generate_content_stream(
                model=model_name,
                contents=[image_part, _COMBINED_PROMPT],
                config=cfg,
            ):
                if chunk.text:
                    yielded = True
                    yield chunk.text
            if yielded:
                return
        except Exception as exc:
            logger.warning(f"Stream model {model_name} failed: {type(exc).__name__}: {str(exc)[:120]}")


# ── Ollama backend ────────────────────────────────────────────────────────────

def _classify_ollama(image_bytes: bytes) -> dict:
    optimized_bytes = _optimize_image(image_bytes)
    payload = {
        "model": settings.ollama_model,
        "prompt": _COMBINED_PROMPT,
        "images": [_image_to_base64(optimized_bytes)],
        "stream": False,
        "format": "json",
        "keep_alive": "24h",
        "options": {"num_predict": _MAX_OUTPUT_TOKENS, "temperature": 0.0},
    }
    resp = _ollama_client.post(
        f"{settings.ollama_base_url}/api/generate",
        json=payload,
        timeout=300.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return _extract_json(data.get("response", "{}"))


def _stream_ollama(image_bytes: bytes) -> Generator[str, None, None]:
    optimized_bytes = _optimize_image(image_bytes)
    payload = {
        "model": settings.ollama_model,
        "prompt": _COMBINED_PROMPT,
        "images": [_image_to_base64(optimized_bytes)],
        "stream": True,
        "format": "json",
        "options": {"num_predict": _MAX_OUTPUT_TOKENS, "temperature": 0.0},
    }
    with _ollama_client.stream(
        "POST", f"{settings.ollama_base_url}/api/generate", json=payload
    ) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                try:
                    data = json.loads(line)
                    token = data.get("response", "")
                    if token:
                        yield token
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue


# ── HuggingFace backend ────────────────────────────────────────────────────────

def _get_hf_model():
    global _hf_model, _hf_processor
    if _hf_model is None:
        with _model_lock:
            if _hf_model is None:
                try:
                    import torch
                    from transformers import AutoProcessor, AutoModelForImageTextToText
                except ImportError:
                    raise RuntimeError(
                        "transformers/torch not installed. Run: pip install transformers torch pillow"
                    )
                model_id = settings.gemma_model
                logger.info(f"Loading HuggingFace model {model_id} — this runs once...")
                _hf_processor = AutoProcessor.from_pretrained(model_id)
                _hf_model = AutoModelForImageTextToText.from_pretrained(
                    model_id,
                    torch_dtype=torch.bfloat16,
                    device_map="auto",
                )
                logger.info("HuggingFace model loaded and cached")
    return _hf_processor, _hf_model


def _classify_huggingface(image_bytes: bytes) -> dict:
    try:
        import torch
        import PIL.Image
    except ImportError:
        raise RuntimeError("transformers/torch not installed.")

    processor, model = _get_hf_model()
    optimized_bytes = _optimize_image(image_bytes)
    image = PIL.Image.open(io.BytesIO(optimized_bytes)).convert("RGB")
    inputs = processor(text=_COMBINED_PROMPT, images=image, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=_MAX_OUTPUT_TOKENS, do_sample=False)
    decoded = processor.decode(output[0], skip_special_tokens=True)
    return _extract_json(decoded)


# ── Result cache helpers ───────────────────────────────────────────────────────

def _cache_key(image_bytes: bytes) -> str:
    return hashlib.md5(image_bytes).hexdigest()


def _get_cached(image_bytes: bytes) -> dict | None:
    return _result_cache.get(_cache_key(image_bytes))


def _store_cached(image_bytes: bytes, result: dict) -> None:
    if len(_result_cache) >= _CACHE_SIZE:
        del _result_cache[next(iter(_result_cache))]
    _result_cache[_cache_key(image_bytes)] = result


# ── Public interface ───────────────────────────────────────────────────────────

def classify_image(image_bytes: bytes) -> dict:
    """Single-shot classification (non-streaming). Checks cache first."""
    cached = _get_cached(image_bytes)
    if cached is not None:
        logger.info("Cache hit — returning cached classification")
        return cached

    backend = settings.gemma_backend
    logger.info(f"Classifying via backend={backend}, model={settings.gemma_model}")

    try:
        if backend == "google_ai_studio":
            result = _classify_google_ai(image_bytes)
        elif backend == "ollama":
            result = _classify_ollama(image_bytes)
        elif backend == "huggingface":
            result = _classify_huggingface(image_bytes)
        else:
            raise ValueError(f"Unknown backend: {backend}")
    except (json.JSONDecodeError, ValueError, KeyError) as exc:
        logger.error(f"JSON/parse error from {backend} [{type(exc).__name__}]: {exc}")
        return _safe_fallback(str(exc))
    except Exception as exc:
        logger.error(
            f"Classification failed — backend={backend} model={settings.gemma_model} "
            f"[{type(exc).__name__}]: {exc}",
            exc_info=True,
        )
        return _safe_fallback(str(exc))

    try:
        _validate_result(result)
    except ValueError as exc:
        logger.error(f"Validation failed: {exc}; returning fallback")
        return _safe_fallback(str(exc))

    _store_cached(image_bytes, result)
    logger.info(f"Classification: {result.get('category')} | confidence={result.get('confidence')}")
    return result


def classify_image_stream(image_bytes: bytes) -> Generator[str, None, None]:
    """
    Streaming classification — yields raw text tokens as the model generates them.
    The caller accumulates tokens and does JSON parsing once the stream ends.
    For cached results the full JSON is yielded as one token.
    """
    cached = _get_cached(image_bytes)
    if cached is not None:
        logger.info("Cache hit — streaming cached result")
        yield json.dumps(cached)
        return

    backend = settings.gemma_backend
    logger.info(f"Streaming via backend={backend}, model={settings.gemma_model}")

    try:
        if backend == "google_ai_studio":
            yield from _stream_google_ai(image_bytes)
        elif backend == "ollama":
            yield from _stream_ollama(image_bytes)
        elif backend == "huggingface":
            result = _classify_huggingface(image_bytes)
            yield json.dumps(result)
        else:
            raise ValueError(f"Unknown backend: {backend}")
    except Exception as exc:
        logger.error(f"Streaming classification error: {exc}", exc_info=True)
        yield json.dumps(_safe_fallback(str(exc)))


def warmup_backend() -> None:
    """Pre-initialize the configured backend at startup to avoid cold-start latency."""
    backend = settings.gemma_backend
    logger.info(f"Warming up backend: {backend}")
    if backend == "google_ai_studio":
        try:
            _get_google_client()
        except Exception as exc:
            logger.warning(f"Google AI warmup failed: {exc}")
    elif backend == "huggingface":
        try:
            _get_hf_model()
        except Exception as exc:
            logger.warning(f"HuggingFace warmup failed: {exc}")
    elif backend == "ollama":
        try:
            _ollama_client.get(f"{settings.ollama_base_url}/api/tags", timeout=5.0)
            logger.info("Ollama connection verified")
        except Exception:
            logger.warning("Ollama not reachable at startup — will retry on first request")


def _safe_fallback(error_msg: str = "") -> dict:
    logger.warning(f"Using fallback classification due to: {error_msg}")
    return {
        "item_identified": "Unknown item",
        "category": "TRASH",
        "confidence": 0.5,
        "is_contaminated": False,
        "contamination_details": "",
        "reasoning": "Unable to analyze",
        "bin_action": "NONE",
        "education_tip": "",
        "pun": "",
        "appreciation_message": "",
        "needs_confirmation": False,
        "confirmation_question": "",
    }


def _validate_result(result: dict) -> None:
    required = {"item_identified", "category", "confidence"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"Gemma response missing fields: {missing}")
    # Normalize in-place so callers see the clean value
    result["category"] = str(result["category"]).strip().upper()
    valid_categories = {"RECYCLABLE", "COMPOST", "TRASH", "HAZARDOUS", "HUMAN", "PENDING"}
    if result["category"] not in valid_categories:
        raise ValueError(f"Invalid category: {result['category']}")
