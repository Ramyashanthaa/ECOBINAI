#!/usr/bin/env bash
# EcoBinAI — Raspberry Pi production run script
# Serves the pre-built React dashboard + FastAPI backend with PCA9685 servo control + USB camera
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
  echo "❌  .env not found. Copy .env.example, then set HARDWARE_MODE=true and HARDWARE_DRIVER=pca9685"
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

# ── start — single worker required (hardware state is process-local) ──────────────
exec uvicorn backend.api.main:app \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1 \
  --log-level info
