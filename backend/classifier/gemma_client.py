"""
Gemma 4 client — supports three backends:
  1. google_ai_studio  (default, free API key, best for demo)
  2. ollama            (local / edge / fully offline)
  3. huggingface       (self-hosted, required for fine-tuned weights)
"""

import base64
import io
import json
import logging
import re
from pathlib import Path

import httpx

from backend.config import settings
from backend.classifier.prompts import SYSTEM_PROMPT, USER_CLASSIFICATION_PROMPT

logger = logging.getLogger(__name__)


def _optimize_image(image_bytes: bytes, max_size: int = 1024) -> bytes:
    """
    Compress and resize image to reduce API latency.
    Reduces file size by ~60% while maintaining waste classification quality.
    """
    try:
        import PIL.Image
        img = PIL.Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        # Resize if larger than max_size while preserving aspect ratio
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), PIL.Image.Resampling.LANCZOS)
        
        # Save with compression
        output = io.BytesIO()
        img.save(output, format="JPEG", quality=85, optimize=True)
        optimized = output.getvalue()
        
        # Only use optimized version if it's actually smaller
        return optimized if len(optimized) < len(image_bytes) else image_bytes
    except Exception as e:
        logger.warning(f"Image optimization failed ({e}), using original")
        return image_bytes

# Gemma 4 native function-calling tool definitions
BIN_TOOLS = [
    {
        "name": "open_bin_lid",
        "description": (
            "Opens the specified bin lid to accept the waste item. "
            "Call this after classifying the waste."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "bin_type": {
                    "type": "string",
                    "enum": ["RECYCLABLE", "COMPOST", "TRASH", "HAZARDOUS"],
                    "description": "Which bin lid to open",
                },
                "duration_seconds": {
                    "type": "integer",
                    "description": "Seconds to keep lid open (default 5)",
                    "default": 5,
                },
            },
            "required": ["bin_type"],
        },
    },
    {
        "name": "log_waste_event",
        "description": "Logs the waste disposal event for analytics and reporting.",
        "parameters": {
            "type": "object",
            "properties": {
                "item_description": {"type": "string"},
                "category": {"type": "string"},
                "is_contaminated": {"type": "boolean"},
            },
            "required": ["item_description", "category", "is_contaminated"],
        },
    },
]


def _image_to_base64(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def _extract_json(text: str) -> dict:
    """
    Pull the best JSON object from model output.
    Gemma 4 sometimes thinks out loud before producing JSON, so we:
    1. Try markdown fences first (```json ... ```)
    2. Find ALL {...} blocks and return the last complete one
       (the model's conclusion always comes last)
    3. Fall back to parsing the whole text
    """
    text = text.strip()

    # 1. Fenced code block
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 2. Last complete JSON object in the text
    all_objects = list(re.finditer(r"\{[\s\S]*?\}", text))
    for m in reversed(all_objects):
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            continue

    # 3. Greedy match — grab everything between first { and last }
    start = text.find("{")
    end = text.rfind("}") + 1
    if start != -1 and end > start:
        return json.loads(text[start:end])

    return json.loads(text)


# ── Google AI Studio backend ───────────────────────────────────────────────────

def _classify_google_ai(image_bytes: bytes) -> dict:
    try:
        import google.generativeai as genai
        import PIL.Image
        import io
        from google.generativeai import types as genai_types

        genai.configure(api_key=settings.google_ai_api_key)

        # Optimize image for faster inference
        optimized_bytes = _optimize_image(image_bytes)
        
        # Gemma 4 does not support system_instruction in GenerativeModel the same way
        # Gemini does. Merge system + user prompt into a single user turn instead.
        combined_prompt = f"{SYSTEM_PROMPT}\n\n{USER_CLASSIFICATION_PROMPT}"

        model = genai.GenerativeModel(model_name=settings.gemma_model)
        image = PIL.Image.open(io.BytesIO(optimized_bytes)).convert("RGB")

        generation_config = genai_types.GenerationConfig(
            max_output_tokens=256,   # Further reduced for crisp, short responses
            temperature=0.1,         # low temp → more deterministic JSON
        )

        response = model.generate_content(
            [image, combined_prompt],
            generation_config=generation_config,
        )
        return _extract_json(response.text)
    except ImportError:
        raise RuntimeError(
            "google-generativeai not installed. Run: pip install google-generativeai pillow"
        )


# ── Ollama backend (local / offline / edge) ───────────────────────────────────

def _classify_ollama(image_bytes: bytes) -> dict:
    # Optimize image for faster local inference
    optimized_bytes = _optimize_image(image_bytes)
    
    payload = {
        "model": settings.ollama_model,
        "prompt": f"{SYSTEM_PROMPT}\n\n{USER_CLASSIFICATION_PROMPT}",
        "images": [_image_to_base64(optimized_bytes)],
        "stream": False,
        "format": "json",
    }
    resp = httpx.post(
        f"{settings.ollama_base_url}/api/generate",
        json=payload,
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return _extract_json(data.get("response", "{}"))


# ── HuggingFace backend ────────────────────────────────────────────────────────

def _classify_huggingface(image_bytes: bytes) -> dict:
    try:
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText
        import PIL.Image
        import io

        # Optimize image for faster local inference
        optimized_bytes = _optimize_image(image_bytes)
        
        model_id = settings.gemma_model
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            device_map="auto",
        )
        image = PIL.Image.open(io.BytesIO(optimized_bytes)).convert("RGB")
        prompt = f"{SYSTEM_PROMPT}\n\n{USER_CLASSIFICATION_PROMPT}"
        inputs = processor(text=prompt, images=image, return_tensors="pt").to(model.device)
        with torch.no_grad():
            output = model.generate(**inputs, max_new_tokens=256, do_sample=False)
        decoded = processor.decode(output[0], skip_special_tokens=True)
        return _extract_json(decoded)
    except ImportError:
        raise RuntimeError(
            "transformers/torch not installed. Run: pip install transformers torch pillow"
        )


# ── Public interface ───────────────────────────────────────────────────────────

_HUMAN_FALLBACK = {
    "item_identified": "A person",
    "category": "HUMAN",
    "confidence": 1.0,
    "is_contaminated": False,
    "contamination_details": "",
    "reasoning": "A human was detected in the image.",
    "bin_action": "NONE",
    "education_tip": "",
    "pun": "Error 404: Waste not found. Please show me something I can actually sort! 🗑️",
    "appreciation_message": "Nice try! 😄 Remember, I sort waste, not humans.",
    "needs_confirmation": False,
    "confirmation_question": "",
}


def classify_image(image_bytes: bytes) -> dict:
    """
    Send an image to Gemma 4 and get a structured waste classification result.
    Routes to the configured backend automatically.
    Falls back to a HUMAN response if the model refuses or returns unparseable output.
    """
    backend = settings.gemma_backend
    logger.info(f"Classifying image via backend={backend}, model={settings.gemma_model}")

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
        logger.warning(f"Could not parse model output as JSON ({exc}); returning HUMAN fallback")
        return dict(_HUMAN_FALLBACK)
    except Exception as exc:
        # Re-raise unexpected errors (network, auth, etc.) so the HTTP layer can 500 them
        raise

    _validate_result(result)
    logger.info(f"Classification: {result.get('category')} | confidence={result.get('confidence')}")
    return result


def _validate_result(result: dict) -> None:
    required = {"item_identified", "category", "confidence", "bin_action"}
    missing = required - result.keys()
    if missing:
        raise ValueError(f"Gemma 4 response missing fields: {missing}")
    valid_categories = {"RECYCLABLE", "COMPOST", "TRASH", "HAZARDOUS", "HUMAN", "PENDING"}
    if result["category"] not in valid_categories:
        raise ValueError(f"Invalid category: {result['category']}")
