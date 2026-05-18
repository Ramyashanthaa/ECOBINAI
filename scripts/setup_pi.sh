#!/usr/bin/env bash
# EcoBinAI Raspberry Pi 5 setup helper — PCA9685 + 4 servos + USB webcam
set -e

echo "🌿 Setting up EcoBinAI for Raspberry Pi 5..."

ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "armv7l" ]; then
  echo "⚠️  Warning: this script targets Raspberry Pi (arm64/armv7l)."
fi

# 1. Python virtual environment
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "✅ Virtual environment created"
fi
# shellcheck disable=SC1091
source .venv/bin/activate

# 2. System dependencies (incl. I2C tools for PCA9685)
echo "📦 Installing Raspberry Pi system packages..."
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  python3-dev python3-venv python3-opencv \
  libjpeg-dev libopenjp2-7-dev libatlas-base-dev libblas-dev liblapack-dev pkg-config \
  i2c-tools v4l-utils

# 3. Enable I2C (PCA9685 needs it)
echo "🔌 Enabling I2C interface..."
sudo raspi-config nonint do_i2c 0 || true
if [ -e /dev/i2c-1 ]; then
  echo "✅ I2C bus 1 available at /dev/i2c-1"
else
  echo "⚠️  /dev/i2c-1 missing — a reboot may be required after enabling I2C"
fi

# 4. Python dependencies (Pi-flavoured requirements file)
pip install --upgrade pip wheel setuptools
pip install -r requirements-pi.txt
echo "✅ Python dependencies installed (PCA9685 + RPi.GPIO + gpiozero)"

# 5. PCA9685 sanity check
echo "🔍 Probing I2C bus for PCA9685 (default address 0x40)..."
if command -v i2cdetect &> /dev/null; then
  i2cdetect -y 1 || true
  echo "    (look for '40' in the table above — that's the PCA9685)"
fi

# 6. Initialise .env if missing
if [ ! -f ".env" ]; then
  cp .env.example .env
  sed -i 's/^HARDWARE_MODE=.*/HARDWARE_MODE=true/'           .env
  sed -i 's/^HARDWARE_DRIVER=.*/HARDWARE_DRIVER=pca9685/'    .env
  sed -i 's/^USB_CAMERA_ENABLED=.*/USB_CAMERA_ENABLED=true/' .env
  echo "✅ .env initialised for Pi 5 (HARDWARE_MODE=true, PCA9685, USB camera on)"
  echo ""
  echo "   ➜ Set your Gemma backend in .env:"
  echo "        GEMMA_BACKEND=ollama           (fully offline)"
  echo "        OLLAMA_MODEL=gemma4:e2b        (or e4b for better accuracy)"
  echo "     or, for cloud inference:"
  echo "        GEMMA_BACKEND=google_ai_studio"
  echo "        GOOGLE_AI_API_KEY=your_key"
fi

# 7. Frontend build (optional — only needed for the browser dashboard)
if command -v npm &> /dev/null; then
  pushd frontend > /dev/null
  npm install --silent
  npm run build
  popd > /dev/null
  echo "✅ Frontend built"
else
  echo "⚠️  Node.js not found — frontend build skipped"
  echo "   The standalone bin works without the dashboard; install Node 18+ if you want it."
fi

echo ""
echo "🚀 Raspberry Pi 5 setup complete!"
echo ""
echo "Test it now with:"
echo "  source .venv/bin/activate"
echo "  uvicorn backend.api.main:app --host 0.0.0.0 --port 8000"
echo ""
echo "Dashboard:  http://<pi-ip>:8000/"
echo "Standalone: hold an item in front of the USB cam — the matching bin opens automatically."
