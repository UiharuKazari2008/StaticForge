# StaticForge test image: Node 20 + git + build tools for native modules.
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 build-essential && rm -rf /var/lib/apt/lists/*
ENV npm_config_cache=/cache/npm
