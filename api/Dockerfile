FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/api

COPY api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY api/server ./server
COPY --from=frontend-builder /build/frontend/dist /app/frontend/dist

RUN mkdir -p /app/api/data

EXPOSE 8082

CMD ["python", "-m", "server", "8082"]
