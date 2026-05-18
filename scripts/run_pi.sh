#!/usr/bin/env bash
# EcoBinAI — Raspberry Pi production run script
# Serves the pre-built React dashboard + FastAPI backend with PCA9685 servo control + USB camera.
# On a Pi with a monitor, also launches Chromium in kiosk mode automatically.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ── virtual environment ──────────────────────────────────────────────────────────
if [ ! -d ".venv" ]; then
  echo "❌  .venv not found. Run: bash scripts/setup_pi.sh"
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# ── .env check ───────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "❌  .env not found. Copy .env.example and configure for the Pi."
  exit 1
fi

HW_MODE=$(grep -E '^HARDWARE_MODE=' .env | cut -d= -f2 | tr -d '[:space:]"'"'" || echo "false")
if [ "$HW_MODE" != "true" ]; then
  echo "⚠️  HARDWARE_MODE is not 'true' in .env — servos will NOT move."
  echo "   Add to .env:  HARDWARE_MODE=true"
  read -rp "   Continue in simulation mode? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || exit 1
fi

# ── build frontend if not already done ───────────────────────────────────────────
if [ ! -d "frontend/dist" ]; then
  echo "📦 frontend/dist not found — building..."
  if command -v npm &>/dev/null; then
    (cd frontend && npm install --silent && npm run build)
    echo "✅ Frontend built"
  else
    echo "⚠️  Node.js not found — dashboard will be unavailable (API still works)"
    echo "   Install Node 18+ and run: cd frontend && npm run build"
  fi
fi

# ── show reachable address ────────────────────────────────────────────────────────
PI_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "🌿 EcoBinAI starting on Raspberry Pi"
echo "   Dashboard : http://${PI_IP:-<pi-ip>}:8000/"
echo "   API docs  : http://${PI_IP:-<pi-ip>}:8000/docs"
echo "   (Ctrl-C to stop)"
echo ""

# ── start backend — single worker required (hardware state is process-local) ─────
uvicorn backend.api.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --log-level info &
BACKEND_PID=$!

# ── wait for backend to be healthy before launching browser ──────────────────────
echo "⏳ Waiting for backend..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "✅ Backend ready"
    break
  fi
  sleep 1
done

# ── launch Chromium in kiosk mode if a display is available ──────────────────────
DISPLAY_ENV="${DISPLAY:-:0}"
BROWSER_PID=""

# Speech synthesis on Linux/Chromium requires --autoplay-policy=no-user-gesture-required
# so the voice readout fires automatically without a manual click.
CHROMIUM_FLAGS=(
  --kiosk
  --noerrdialogs
  --disable-infobars
  --no-first-run
  --disable-session-crashed-bubble
  --autoplay-policy=no-user-gesture-required
  --disable-features=TranslateUI
  "http://localhost:8000"
)

if DISPLAY="$DISPLAY_ENV" xset q &>/dev/null 2>&1; then
  # A display is reachable — find whichever Chromium binary is installed
  CHROMIUM_BIN=""
  for bin in chromium-browser chromium google-chrome; do
    if command -v "$bin" &>/dev/null; then
      CHROMIUM_BIN="$bin"
      break
    fi
  done

  if [ -n "$CHROMIUM_BIN" ]; then
    echo "🌐 Launching $CHROMIUM_BIN in kiosk mode on display $DISPLAY_ENV..."
    DISPLAY="$DISPLAY_ENV" "$CHROMIUM_BIN" "${CHROMIUM_FLAGS[@]}" &
    BROWSER_PID=$!
    echo "✅ Browser started (PID $BROWSER_PID)"
  else
    echo "⚠️  No Chromium/Chrome found — open http://localhost:8000 manually"
    echo "   Install with: sudo apt-get install chromium-browser"
  fi
else
  echo "ℹ️  No display detected — open http://${PI_IP:-<pi-ip>}:8000 from another device"
fi

# ── graceful shutdown on Ctrl-C ──────────────────────────────────────────────────
trap 'echo ""; echo "Stopping..."; kill "$BACKEND_PID" 2>/dev/null; [ -n "$BROWSER_PID" ] && kill "$BROWSER_PID" 2>/dev/null; exit 0' SIGINT SIGTERM

wait "$BACKEND_PID"
