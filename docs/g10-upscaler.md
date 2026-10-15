# G10 upscaler and multi-worker routing

Dreamscape can send still upscales to more than one local worker. Animate jobs stay on workers whose `/health` reports `animate`. Sala installs the G10 process and the `secure.config.json` entries. Do not commit keys, do not edit the live secure config from the repo, and do not restart Dreamscape to pick this up.

## Workers

`modules/localUpscaleWorker.js` reads `localWorkers` from `secure.config.json`. Each entry is `{ url, key, models, maxScale, priority }` plus an optional `id` (`ruiko` or `g10`). Higher `priority` wins Fast when more than one healthy worker can do the requested scale. A single legacy `localWorker: { url, key }` still works and is treated as Ruiko.

| Delivery | Route |
| --- | --- |
| Instant | NovelAI, when that upscale is available for the image. Spends Anlas. |
| Fast | The healthy worker with the highest priority whose `maxScale` and models cover the scale. That is Ruiko or G10, whichever can do it. |
| Slow | G10 while the scale is within G10 `maxScale`. Ruiko after that. |

Animate (`/jobs` with `type: animate`) is sent only to a worker whose health check lists `animate`. The G10 process does not.

## G10 process

`services/g10-upscaler/server.js` wraps `realesrgan-ncnn-vulkan` (`/home/kanmi/opt/realesrgan`, Vulkan on Vega 8). It listens on `127.0.0.1` only.

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/health` | Optional. Without a bearer token the body is `ok`, `service`, `version`, `auth: "required"`. |
| GET | `/models` | Bearer |
| POST | `/jobs` | Bearer. JSON `{ "image": "<base64>", "model", "scale" }`. |
| GET | `/jobs/:id` | Bearer |
| GET | `/jobs/:id/result` | Bearer. PNG bytes. |

`vkQueueSubmit failed` in the binary output fails the job even when the process exits 0.

| Model | Scales | Delivery | Default |
| --- | --- | --- | --- |
| `realesr-animevideov3` | 2, 4 | Fast | On |
| `realesrgan-x4plus-anime` | 4 | Slow, about 34s | On |
| `realesrgan-x4plus` (`RealESRGAN_x4plus`) | 4 | Optional | Off. GPU resets on this Vega 8. Set `G10_ENABLE_X4PLUS=1` to allow it. |

Env: `G10_WORKER_KEY` or `G10_WORKER_KEY_FILE`, `G10_PORT` (default `8190`), `G10_REALESRGAN_BIN`, `G10_MODEL_DIR`, `G10_GPU_NAME`.

```bash
node services/g10-upscaler/server.js
```

## Sample secure config

Placeholders only. Put the real key in the gitignored `secure.config.json` on the Dreamscape host.

```json
{
  "localWorkers": [
    {
      "id": "ruiko",
      "url": "http://ruiko.lan:8188",
      "key": "<contents of the Ruiko worker.key>",
      "models": ["RealESRGAN_x4plus", "RealESRGAN_x4plus_anime_6B", "4x-UltraSharp"],
      "maxScale": 4,
      "priority": 20
    },
    {
      "id": "g10",
      "url": "http://127.0.0.1:8190",
      "key": "<G10 worker key>",
      "models": ["realesr-animevideov3", "realesrgan-x4plus-anime"],
      "maxScale": 4,
      "priority": 10
    }
  ]
}
```

The old shape still loads as the Ruiko worker:

```json
"localWorker": { "url": "http://ruiko.lan:8188", "key": "<worker.key>" }
```

When `localWorkers` is a non-empty list it wins over `localWorker`.

## systemd example

Do not install this from the repo. `Restart=on-failure` is the process supervisor. There is no cron and no memory-restart timer.

```ini
[Unit]
Description=G10 RealESRGAN upscaler
After=network.target

[Service]
Type=simple
User=kanmi
WorkingDirectory=/home/kanmi/staticforge
ExecStart=/usr/bin/node /home/kanmi/staticforge/services/g10-upscaler/server.js
Environment=G10_PORT=8190
Environment=G10_WORKER_KEY_FILE=/home/kanmi/.secrets/g10-worker.key
Environment=G10_REALESRGAN_BIN=/home/kanmi/opt/realesrgan/realesrgan-ncnn-vulkan
Environment=G10_MODEL_DIR=/home/kanmi/opt/realesrgan/models
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

## PM2 example

Do not add this app to Dreamscape's `ecosystem.config.js`. Do not set `watch`, `max_memory_restart`, or `cron_restart`.

```javascript
module.exports = {
    apps: [{
        name: 'g10-upscaler',
        script: './services/g10-upscaler/server.js',
        cwd: '/home/kanmi/staticforge',
        autorestart: true,
        watch: false,
        env: {
            G10_PORT: '8190',
            G10_WORKER_KEY_FILE: '/home/kanmi/.secrets/g10-worker.key',
            G10_REALESRGAN_BIN: '/home/kanmi/opt/realesrgan/realesrgan-ncnn-vulkan',
            G10_MODEL_DIR: '/home/kanmi/opt/realesrgan/models'
        }
    }]
};
```

`watch` is false. Leave `max_memory_restart` and `cron_restart` unset.
