#!/usr/bin/env bash
# EcoBinAI — one-command local setup (Mac / Linux)
set -e

echo "🌍 Setting up EcoBinAI..."

# 1. Python virtual environment
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  echo "✅ Virtual environment created"
fi
source .venv/bin/activate

# 2. Python dependencies
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
echo "✅ Python dependencies installed"

# 3. Copy .env if not present
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo "✅ .env created from .env.example"
  echo ""
  echo "⚠️  ACTION REQUIRED: Add your Google AI Studio API key to .env"
  echo "    Get a free key at: https://aistudio.google.com/app/apikey"
  echo "    Set: GOOGLE_AI_API_KEY=your_key_here"
  echo ""
fi

# 4. Frontend
if command -v node &> /dev/null; then
  cd frontend
  npm install --silent
  npm run build
  cd ..
  echo "✅ Frontend built"
else
  echo "⚠️  Node.js not found — skipping frontend build"
  echo "   Install Node.js 18+ and run: cd frontend && npm install && npm run build"
fi

# 5. Generate synthetic training data (for fine-tuning demo)
python -m model.dataset_prep --source synthetic --output data/train.jsonl
echo "✅ Synthetic training dataset generated at data/train.jsonl"

echo ""
echo "🚀 Setup complete! Run the app with:"
echo "   source .venv/bin/activate"
echo "   uvicorn backend.api.main:app --reload"
echo "   # Then open http://localhost:8000"
