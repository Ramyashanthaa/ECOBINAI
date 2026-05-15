# ── Frontend build stage ─────────────────────────────────────────────────────
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Python deps stage ────────────────────────────────────────────────────────
FROM python:3.12.13-slim AS builder
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN python -m venv .venv
COPY requirements.txt ./
RUN .venv/bin/pip install --upgrade pip && \
    .venv/bin/pip install --no-cache-dir -r requirements.txt

# ── Final runtime image ──────────────────────────────────────────────────────
FROM python:3.12.13-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY . .
COPY --from=frontend /app/frontend/dist /app/frontend/dist

EXPOSE 8080
CMD ["/app/.venv/bin/uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8080"]
