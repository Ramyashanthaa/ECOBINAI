#!/usr/bin/env bash
# Start EcoBinAI in development mode with live reload
set -e

source .venv/bin/activate 2>/dev/null || true

echo "🌍 Starting EcoBinAI..."
echo "   Backend API : http://localhost:8000"
echo "   Frontend Dev: http://localhost:3000"
echo "   API Docs    : http://localhost:8000/docs"
echo ""

# Start backend in background
uvicorn backend.api.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "✅ Backend started (PID $BACKEND_PID)"

# Start frontend dev server if Node is available
if command -v node &> /dev/null && [ -d "frontend/node_modules" ]; then
  cd frontend
  npm run dev &
  FRONTEND_PID=$!
  cd ..
  echo "✅ Frontend started (PID $FRONTEND_PID)"
fi

# Graceful shutdown on Ctrl-C
trap "echo ''; echo 'Stopping...'; kill $BACKEND_PID 2>/dev/null; kill $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
