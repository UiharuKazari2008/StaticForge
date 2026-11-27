# syntax=docker/dockerfile:1
# Dreamscape (StaticForge) server image. Same base as the live server: Debian 13 (trixie), Node 24.
# Used every day for Rack Manager replicas (docs/rack-manager/replicas.md), so it stays true to what the server needs.
# Build:  docker build -t dreamscape:local .      Run: docker compose up   (or the rackd `replicas` role)

FROM node:24-trixie

LABEL org.opencontainers.image.title="Dreamscape"
LABEL org.opencontainers.image.description="NovelAI proxy and workspace (StaticForge)"

ENV DREAMSCAPE_SETUP_TARGET=docker \
    DREAMSCAPE_APP_ROOT=/app \
    NODE_ENV=production \
    MALLOC_ARENA_MAX=2

WORKDIR /app

# System deps. Native modules: better-sqlite3, sqlite3 (libsqlite3-dev), canvas (cairo/pango/jpeg/gif/rsvg),
# sharp (built from source against the system libvips 8.16 so it reads JPEG XL, #1134), node-pty (build-essential, python3).
# Runtime tools the server spawns: ruby (DText parser), git, zstd + tar (update engine), ffmpeg + ffprobe (animation, video),
# cjxl / djxl (libjxl-tools: JXL gallery storage), tmux, sqlite3 (backups, diagnostics), curl.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 python-is-python3 pkg-config \
    libsqlite3-dev sqlite3 \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libvips-dev libjxl-tools \
    ruby git zstd ffmpeg tmux curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Layer cache: install deps before the full source copy
COPY package.json pnpm-lock.yaml .npmrc ./
COPY patches/ ./patches/
COPY scripts/configure-nekoai.js scripts/setup.sh scripts/docker-entrypoint.sh ./scripts/
COPY scripts/templates/ ./scripts/templates/

# --skip-apt: the packages are installed above. The lockfile pins nekoai-js to file:../NekoAI-JS and
# scripts/configure-nekoai.js switches it to the registry, so the lockfile cannot be frozen.
RUN chmod +x scripts/setup.sh scripts/docker-entrypoint.sh \
    && DREAMSCAPE_APP_ROOT=/app bash scripts/setup.sh --skip-apt --skip-config

COPY . .

# Warm .cache/runtime-assets in the image. A bind-mounted .cache is warmed again
# by scripts/setup.sh --runtime before the server listens.
RUN node scripts/precompile-runtime-assets.js

EXPOSE 9220

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
