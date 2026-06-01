# syntax=docker/dockerfile:1

FROM node:20-bookworm

LABEL org.opencontainers.image.title="Dreamscape"
LABEL org.opencontainers.image.description="NovelAI proxy and workspace (StaticForge)"

ENV DREAMSCAPE_SETUP_TARGET=docker \
    DREAMSCAPE_APP_ROOT=/app \
    NODE_ENV=production

WORKDIR /app

# System deps for native modules + Ruby DText parser
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python-is-python3 pkg-config ruby \
    libsqlite3-dev \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libhunspell-dev \
    && rm -rf /var/lib/apt/lists/*

# Layer cache: install deps before full source copy
COPY package.json pnpm-lock.yaml .npmrc ./
COPY patches/ ./patches/
COPY scripts/configure-nekoai.js scripts/setup.sh scripts/docker-entrypoint.sh ./scripts/
COPY scripts/templates/ ./scripts/templates/

RUN chmod +x scripts/setup.sh scripts/docker-entrypoint.sh \
    && DREAMSCAPE_APP_ROOT=/app bash scripts/setup.sh --skip-apt --skip-config --frozen-lockfile

COPY . .

EXPOSE 9220

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
