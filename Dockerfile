# ── Stage 1: Build React frontend ──────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS build-frontend

WORKDIR /app/frontend

COPY frontend/package.json ./
RUN npm install --no-audit --prefer-offline 2>/dev/null || npm install --no-audit

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ─────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM python:3.12-slim

WORKDIR /app

# Install Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./

# Copy built frontend into backend/static so FastAPI can serve it
COPY --from=build-frontend /app/frontend/dist ./static

EXPOSE 8004

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
