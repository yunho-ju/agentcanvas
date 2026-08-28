# syntax=docker/dockerfile:1.7

FROM python:3.12.11-slim-bookworm AS api-builder
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /app
RUN pip install --no-cache-dir uv==0.8.15

COPY pyproject.toml uv.lock ./
COPY packages/contracts/pyproject.toml packages/contracts/pyproject.toml
COPY packages/engine/pyproject.toml packages/engine/pyproject.toml
COPY packages/adapters/pyproject.toml packages/adapters/pyproject.toml
COPY packages/api/pyproject.toml packages/api/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace

COPY packages ./packages
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12.11-slim-bookworm AS api-runtime
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AGENTCANVAS_DB=/data/agentcanvas.db \
    AGENTCANVAS_BACKUP_DIR=/backups
WORKDIR /app
RUN groupadd --gid 10001 agentcanvas \
    && useradd --uid 10001 --gid agentcanvas --no-create-home --shell /usr/sbin/nologin agentcanvas \
    && mkdir -p /data /backups \
    && chown agentcanvas:agentcanvas /data /backups
COPY --from=api-builder --chown=agentcanvas:agentcanvas /app/.venv /app/.venv
USER agentcanvas
EXPOSE 8000
VOLUME ["/data", "/backups"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=2)"]
CMD ["uvicorn", "agentcanvas_api.app:serves", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

FROM node:22.20.0-bookworm-slim AS studio-builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/studio/package.json apps/studio/package.json
RUN pnpm install --frozen-lockfile
COPY apps/studio ./apps/studio
COPY packages/contracts/json_schema ./packages/contracts/json_schema
COPY examples ./examples
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @agentcanvas/studio build

FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS studio-runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=studio-builder /app/apps/studio/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/ || exit 1
