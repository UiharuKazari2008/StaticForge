# G10 upscaler

Standalone RealESRGAN worker for the G10 host (Vega 8, `realesrgan-ncnn-vulkan`). Bind is `127.0.0.1`. Dreamscape reaches it through `localWorkers` in `secure.config.json`.

Install, sample config, systemd, and PM2 are in [docs/g10-upscaler.md](../../docs/g10-upscaler.md). Sala installs the process and the config. Do not add this app to Dreamscape's `ecosystem.config.js`, and do not set PM2 `watch`, `max_memory_restart`, or `cron_restart`.

```bash
node services/g10-upscaler/server.js
```
