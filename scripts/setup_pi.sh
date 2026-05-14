#!/usr/bin/env bash
# EcoBinAI Raspberry Pi 5 setup helper
set -e

echo "🌿 Setting up EcoBinAI for Raspberry Pi 5..."

ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "armv7l" ]; then
  echo "⚠️  Warning: This script is intended for Raspberry Pi systems (arm64/armv7l)."
fi

# 1. Python virtual environment
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "✅ Virtual environment created"
fi
source .venv/bin/activate

# 2. System dependencies
echo "📦 Installing Raspberry Pi system packages..."
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  python3-dev python3-venv python3-opencv libjpeg-dev libopenjp2-7-dev libatlas-base-dev libblas-dev liblapack-dev pkg-config

# 3. Python dependencies
pip install --upgrade pip wheel setuptools
pip install -r requirements-pi.txt

echo "✅ Python dependencies installed"

# 4. Copy .env if not present
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✅ .env created from .env.example"
  echo ""
  echo "⚠️  Update .env with your settings:" \
       "GEMMA_BACKEND=ollama" \
       "OLLAMA_MODEL=gemma4:e2b" \
       "HARDWARE_MODE=true"
fi

# 5. Frontend build (optional)
if command -v npm &> /dev/null; then
  cd frontend
  npm install --silent
  npm run build
  cd ..
  echo "✅ Frontend built"
else
  echo "⚠️  Node.js not found — frontend build skipped"
  echo "   Install Node.js 18+ and run: cd frontend && npm install && npm run build"
fi

echo ""
echo "🚀 Raspberry Pi 5 setup complete!"
echo "Run the app with:"
echo "  source .venv/bin/activate"
echo "  uvicorn backend.api.main:app --host 0.0.0.0 --port 8000"
