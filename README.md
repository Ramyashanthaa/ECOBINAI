# 🌍 EcoBinAI — Smart Waste Sorting with Gemma 4

> **Gemma 4 Good Hackathon Submission**  
> Theme: Global Resilience · Category: Environmental AI · Model: Gemma 4 (multimodal)

EcoBinAI turns any trash bin into an intelligent waste-sorting station. A camera mounted on the bin analyzes waste items in real time using Gemma 4's multimodal vision. The correct bin lid opens automatically — no sorting knowledge required from the user.

**The contamination rule**: If a recyclable container (plastic, glass, metal, cardboard) has visible food residue, it is classified as **TRASH** — not RECYCLABLE. This is the single biggest source of recycling stream contamination worldwide.

---

## Problem

- Recycling contamination rates average **25% globally** — one contaminated item can ruin an entire batch
- Most people genuinely want to recycle correctly but don't know the rules
- Smart sorting solutions exist only in high-tech, high-income facilities

## Solution

EcoBinAI brings smart sorting to **any bin, anywhere** — including communities with spotty internet, schools, hospitals, and outdoor public spaces — by running Gemma 4 fully locally on an edge device (Raspberry Pi 5) using the E2B/E4B models.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      EcoBinAI System                    │
│                                                         │
│  📷 Camera  ──►  🧠 Gemma 4 Vision  ──►  🔧 Function   │
│  (or upload)      (multimodal)           Calling        │
│                        │                    │           │
│              Classification +          open_bin_lid()   │
│              Contamination Check       log_event()      │
│                        │                    │           │
│                   📊 Dashboard  ◄──  🗄️ SQLite DB       │
│                 (React + WebSocket)                     │
└─────────────────────────────────────────────────────────┘
```

### Gemma 4 Features Used

| Feature | How EcoBinAI Uses It |
|---|---|
| **Multimodal Vision** | Analyzes real-time camera images to identify waste items |
| **Native Function Calling** | Calls `open_bin_lid()` and `log_waste_event()` directly |
| **Edge Deployment (E2B/E4B)** | Runs fully offline on Raspberry Pi 4 via Ollama |
| **Domain Fine-tuning** | LoRA-fine-tuned on TACO + TrashNet waste datasets |
| **Instruction Following** | Strict JSON output for contamination-aware classification |

---

## Waste Categories

| Category | Examples | Bin |
|---|---|---|
| ♻️ **RECYCLABLE** | Clean bottles, cans, cardboard, glass | Green |
| 🌱 **COMPOST** | Food scraps, peels, coffee grounds, soiled paper | Orange |
| 🗑️ **TRASH** | Contaminated recyclables, styrofoam, chip bags | Gray |
| ⚠️ **HAZARDOUS** | Batteries, electronics, paint, medications | Red |

**Contamination Rule**: A recyclable item with food residue → classified as TRASH automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Model | **Gemma 4** (via Google AI Studio API or Ollama locally) |
| Fine-tuning | **Unsloth + LoRA** on TACO / TrashNet dataset |
| Backend | **FastAPI** + **SQLAlchemy** + SQLite |
| Camera | **OpenCV** (hardware) / image upload (simulation) |
| Hardware | **RPi.GPIO** + servo motors (Pi) / software simulator (Mac/PC) |
| Frontend | **React 18** + **Tailwind CSS** + Recharts + WebSocket |
| Edge Runtime | **Ollama** with Gemma 4 E2B/E4B |
| Deployment | **Docker** + docker-compose |

---

## Quick Start (Simulation Mode — zero cost, works on any Mac/PC)

### Prerequisites
- Python 3.11+
- Node.js 18+ (for frontend)
- A free Google AI Studio API key

### 1. Clone & Setup
```bash
git clone <repo-url>
cd EcoBinAI
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### 2. Add your API key
```bash
# Edit .env
GOOGLE_AI_API_KEY=your_free_key_here   # from https://aistudio.google.com/app/apikey
```

### 3. Run
```bash
./scripts/run_demo.sh
# Open http://localhost:3000
```

Upload a photo of any waste item — Gemma 4 will classify it and the correct bin lid animates open.

---

## Edge / Offline Mode (Raspberry Pi 5 + Ollama)

```bash
# On the Raspberry Pi 5
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:e2b    # or gemma4:e4b for better accuracy
```

### Raspberry Pi 5 hardware setup
1. Boot Raspberry Pi OS 64-bit and connect to the network.
2. Install system dependencies:
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-dev python3-opencv \
  libjpeg-dev libopenjp2-7-dev libatlas-base-dev libblas-dev liblapack-dev pkg-config
```
3. Run the Pi setup helper:
```bash
chmod +x scripts/setup_pi.sh
./scripts/setup_pi.sh
```
4. Configure `.env` for edge hardware:
```bash
GEMMA_BACKEND=ollama
OLLAMA_MODEL=gemma4:e2b
HARDWARE_MODE=true
CAMERA_INDEX=/dev/video0  # or 0 for the first USB/CSI camera
```
5. Start the backend on the Pi:
```bash
source .venv/bin/activate
uvicorn backend.api.main:app --host 0.0.0.0 --port 8000
```

If you want the Pi to control GPIO from Docker, mount `/dev/gpiomem` and run with `HARDWARE_MODE=true`.

No internet connection required after model download.

---

## Fine-tuning Gemma 4 on Waste Data

Run on a free Kaggle T4 GPU notebook:

```bash
# Prepare dataset (TrashNet or synthetic)
python -m model.dataset_prep --source trashnet \
    --input data/dataset-resized --output data/train.jsonl

# Fine-tune with Unsloth + LoRA (~90 min on T4)
python -m model.fine_tune \
    --model google/gemma-4-e2b-it \
    --data  data/train.jsonl \
    --output ./fine_tuned_ecobin \
    --push_to_hub your-username/ecobin-gemma4-e2b

# Evaluate
python -m model.evaluate --data data/test.jsonl
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/classify/image` | Classify a waste item image |
| `GET` | `/api/classify/lid-states` | Current bin lid states |
| `WS` | `/api/classify/ws/lid-states` | Real-time lid state stream |
| `GET` | `/api/stats/` | Aggregated waste statistics |
| `GET` | `/api/stats/recent` | Recent classification events |
| `GET` | `/api/health` | System health check |

Full interactive docs at `/docs` (Swagger UI).

---

## Running Tests

```bash
source .venv/bin/activate
pytest tests/ -v
```

Tests cover: classifier logic, contamination detection, API endpoints, hardware simulator, WebSocket events.

---

## Impact

- **No internet required** — works in schools, hospitals, rural communities
- **Language independent** — vision-based, no text literacy required
- **Scalable** — same software runs on a $55 Raspberry Pi or a data-center server
- **Educational** — real-time eco tips teach users correct sorting habits
- **Analytics** — tracks contamination rates to improve local recycling programs

---

## Project Structure

```
EcoBinAI/
├── backend/
│   ├── api/            # FastAPI routes, schemas
│   ├── classifier/     # Gemma 4 client, waste classifier, prompts
│   ├── hardware/       # Bin controller, camera, simulator
│   └── database/       # SQLAlchemy models, CRUD
├── frontend/
│   └── src/            # React dashboard with animated bins
├── model/
│   ├── fine_tune.py    # Unsloth LoRA fine-tuning
│   ├── dataset_prep.py # TACO / TrashNet / synthetic dataset builder
│   └── evaluate.py     # Accuracy + F1 evaluation
├── tests/              # pytest suite (classifier, API, simulator)
├── docker/             # Dockerfile + docker-compose
└── scripts/            # setup.sh, run_demo.sh
```

---

*Built for the Gemma 4 Good Hackathon · Powered by Google Gemma 4*
