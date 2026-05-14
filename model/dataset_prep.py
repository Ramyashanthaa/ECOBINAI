"""
Prepare a waste classification dataset for Gemma 4 fine-tuning.

Supported sources:
  1. TrashNet  — 6 categories, ~2500 images (download required)
  2. TACO      — 60 categories mapped to our 4 bins (download required)
  3. Synthetic — generates text-only instruction pairs for quick testing

Run:
  python -m model.dataset_prep --source synthetic --output data/train.jsonl
  python -m model.dataset_prep --source trashnet  --input data/dataset-resized \
      --output data/train.jsonl
"""

import argparse
import base64
import json
import os
import random
from pathlib import Path

# TrashNet → EcoBinAI category mapping
TRASHNET_MAP = {
    "glass":     "RECYCLABLE",
    "paper":     "RECYCLABLE",
    "cardboard": "RECYCLABLE",
    "plastic":   "RECYCLABLE",
    "metal":     "RECYCLABLE",
    "trash":     "TRASH",
}

# TACO supercategory → EcoBinAI mapping
TACO_MAP = {
    "Plastic":             "RECYCLABLE",
    "Glass":               "RECYCLABLE",
    "Metal":               "RECYCLABLE",
    "Paper":               "RECYCLABLE",
    "Carton":              "RECYCLABLE",
    "Food waste":          "COMPOST",
    "Organic waste":       "COMPOST",
    "Battery":             "HAZARDOUS",
    "Electronic":          "HAZARDOUS",
    "Cigarette":           "TRASH",
    "Styrofoam":           "TRASH",
    "Other":               "TRASH",
    "Unknown":             "TRASH",
}

SYSTEM_PROMPT = (
    "You are EcoBinAI, an expert waste classification assistant. "
    "Analyze the waste item and return ONLY valid JSON with keys: "
    "item_identified, category (RECYCLABLE|COMPOST|TRASH|HAZARDOUS), "
    "confidence (0-1), is_contaminated (bool), contamination_details, "
    "reasoning, bin_action (OPEN_RECYCLABLE|OPEN_COMPOST|OPEN_TRASH|OPEN_HAZARDOUS), "
    "education_tip."
)

# ── Synthetic dataset (no images, text-only, for quick unit-testing) ──────────

SYNTHETIC_EXAMPLES = [
    ("empty plastic water bottle", "RECYCLABLE", False, "", 0.97,
     "Empty, clean PET plastic bottle — recyclable.", "OPEN_RECYCLABLE",
     "Rinse bottles before recycling to avoid contamination."),
    ("banana peel", "COMPOST", False, "", 0.99,
     "Organic fruit peel — goes to compost.", "OPEN_COMPOST",
     "Composting banana peels enriches soil with potassium."),
    ("plastic bottle with ketchup residue", "TRASH", True, "Food residue visible inside", 0.95,
     "Recyclable container contaminated with food — classified as trash.", "OPEN_TRASH",
     "Always rinse containers before recycling to keep the stream clean."),
    ("AA battery", "HAZARDOUS", False, "", 0.98,
     "Single-use battery contains toxic chemicals — hazardous waste.", "OPEN_HAZARDOUS",
     "Place in the dedicated hazardous bin for safe disposal."),
    ("pizza box with grease stains", "TRASH", True, "Grease soaks paper fibres, making it non-recyclable", 0.93,
     "Greasy pizza box is not recyclable — discard in trash.", "OPEN_TRASH",
     "Tear off the clean top of a pizza box and recycle that part."),
    ("coffee grounds", "COMPOST", False, "", 0.98,
     "Organic material — excellent compost addition.", "OPEN_COMPOST",
     "Coffee grounds add nitrogen to compost and repel pests."),
    ("aluminium soda can (empty)", "RECYCLABLE", False, "", 0.99,
     "Clean aluminium can — highly recyclable.", "OPEN_RECYCLABLE",
     "Aluminium can be recycled indefinitely without quality loss."),
    ("styrofoam cup", "TRASH", False, "", 0.96,
     "Expanded polystyrene is not accepted in most recycling streams.", "OPEN_TRASH",
     "Avoid single-use styrofoam — opt for reusable cups."),
    ("glass wine bottle (clean)", "RECYCLABLE", False, "", 0.97,
     "Clean glass bottle — recyclable at glass banks.", "OPEN_RECYCLABLE",
     "Remove metal caps before recycling glass bottles."),
    ("smartphone", "HAZARDOUS", False, "", 0.99,
     "Electronics contain heavy metals — must go to e-waste collection.", "OPEN_HAZARDOUS",
     "Place in the dedicated hazardous bin for safe disposal."),
    ("newspaper", "RECYCLABLE", False, "", 0.98,
     "Clean paper — fully recyclable.", "OPEN_RECYCLABLE",
     "Keep paper dry; wet or contaminated paper should be composted."),
    ("apple core", "COMPOST", False, "", 0.99,
     "Organic food waste — ideal for composting.", "OPEN_COMPOST",
     "Home composting can divert up to 30% of household waste from landfill."),
    ("chip bag (foil-lined)", "TRASH", False, "", 0.95,
     "Multi-layer foil-plastic laminate — not recyclable in standard streams.", "OPEN_TRASH",
     "Some brands offer mail-in recycling for foil snack bags."),
    ("cardboard box (clean)", "RECYCLABLE", False, "", 0.98,
     "Corrugated cardboard — highly recyclable when dry and clean.", "OPEN_RECYCLABLE",
     "Flatten boxes to save space in the recycling bin."),
    ("paint can (partially full)", "HAZARDOUS", False, "", 0.97,
     "Liquid paint is hazardous waste — requires special disposal.", "OPEN_HAZARDOUS",
     "Place in the dedicated hazardous bin for safe disposal."),
]


def make_synthetic_record(example: tuple) -> dict:
    (item, category, contaminated, contam_detail, conf, reasoning, action, tip) = example
    answer = json.dumps({
        "item_identified": item,
        "category": category,
        "confidence": conf,
        "is_contaminated": contaminated,
        "contamination_details": contam_detail,
        "reasoning": reasoning,
        "bin_action": action,
        "education_tip": tip,
    })
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": f"Classify this waste item: {item}"},
            {"role": "assistant", "content": answer},
        ]
    }


def build_synthetic_dataset(output_path: Path, n_repeats: int = 10) -> None:
    records = []
    for _ in range(n_repeats):
        for ex in SYNTHETIC_EXAMPLES:
            records.append(make_synthetic_record(ex))
    random.shuffle(records)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"Synthetic dataset: {len(records)} records → {output_path}")


# ── TrashNet image dataset ─────────────────────────────────────────────────────

def _image_to_data_url(path: Path) -> str:
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    suffix = path.suffix.lower().lstrip(".")
    mime = "jpeg" if suffix in ("jpg", "jpeg") else suffix
    return f"data:image/{mime};base64,{b64}"


def build_trashnet_dataset(input_dir: Path, output_path: Path) -> None:
    """
    Expects TrashNet folder structure:
      input_dir/
        glass/   *.jpg
        paper/   *.jpg
        ...
    """
    records = []
    for folder in input_dir.iterdir():
        if not folder.is_dir():
            continue
        category = TRASHNET_MAP.get(folder.name.lower(), "TRASH")
        for img_file in folder.glob("*.jpg"):
            try:
                data_url = _image_to_data_url(img_file)
            except Exception:
                continue
            answer = json.dumps({
                "item_identified": folder.name,
                "category": category,
                "confidence": 0.95,
                "is_contaminated": False,
                "contamination_details": "",
                "reasoning": f"{folder.name} → {category}",
                "bin_action": f"OPEN_{category}",
                "education_tip": "",
            })
            records.append({
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": data_url}},
                            {"type": "text", "text": "Classify this waste item."},
                        ],
                    },
                    {"role": "assistant", "content": answer},
                ]
            })

    random.shuffle(records)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"TrashNet dataset: {len(records)} records → {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["synthetic", "trashnet"], default="synthetic")
    parser.add_argument("--input", type=Path, default=Path("data/dataset-resized"))
    parser.add_argument("--output", type=Path, default=Path("data/train.jsonl"))
    parser.add_argument("--repeats", type=int, default=10, help="Synthetic dataset repeat factor")
    args = parser.parse_args()

    if args.source == "synthetic":
        build_synthetic_dataset(args.output, args.repeats)
    elif args.source == "trashnet":
        build_trashnet_dataset(args.input, args.output)
