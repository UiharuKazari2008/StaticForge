# Ruiko upscaler

Local GPU worker for Dreamscape card #393. It runs on **Ruiko** (Windows 11, RTX 2070 Super, 8 GB) and upscales images with spandrel. Dreamscape talks to it over the LAN. Upscales are free (no NovelAI Anlas).

Bind: `0.0.0.0:8188`. One job at a time (in-memory FIFO). Finished jobs are dropped after one hour.

## Auth

Set `RUIKO_WORKER_KEY` or point `RUIKO_WORKER_KEY_FILE` at a file (install.ps1 writes `F:\dreamscape-worker\worker.key`).

| Route | Auth |
| --- | --- |
| `GET /health` | Optional. Without a bearer token the body is only `ok`, `service`, `version`, and `auth: "required"`. With `Authorization: Bearer <key>` it also returns `gpu`, VRAM totals, `queue_length`, `loaded_models`, and `version`. |
| `GET /models` | Bearer required. |
| `POST /jobs` | Bearer required. |
| `GET /jobs/{id}` | Bearer required. |
| `GET /jobs/{id}/result` | Bearer required. PNG bytes. |

If no key is configured, authed routes return 503.

## API

`POST /jobs` accepts either:

- JSON: `{"image": "<base64>", "model": "RealESRGAN_x4plus", "scale": 4}`
- multipart: fields `image` (file), `model`, `scale`

Response: `{"job_id": "..."}` immediately. Scales are `2` or `4` (models are native 4x; scale 2 resizes after). Images are limited to 32 MB and a 4096 px edge. The queue holds 16 jobs.

`GET /jobs/{id}` returns `status` (`queued`, `running`, `completed`, `failed`), `progress`, `error`, `model`, `scale`.

Models:

- `RealESRGAN_x4plus`
- `RealESRGAN_x4plus_anime_6B`
- `4x-UltraSharp`

## Inference

Weights load through spandrel. On an 8 GB card, fp16 tiles start at 256 px with 32 px overlap when the model supports half precision. fp32 starts at 128 px. If CUDA runs out of memory the tile size steps down (256, 192, 128, 96, 64) and the cache is cleared between tries.

## Install on Ruiko

1. Copy this folder onto Ruiko (the script's directory is the service working directory).
2. Install Python 3.11+ and [NSSM](https://nssm.cc/).
3. `powershell -ExecutionPolicy Bypass -File .\install.ps1`

That creates `F:\dreamscape-worker\venv`, installs the CUDA 12.4 PyTorch wheel (Turing sm_75), installs `requirements.txt`, downloads the three weights into `F:\dreamscape-worker\models` and checks SHA256, generates `worker.key` if it is missing, and registers the NSSM service `RuikoUpscaler` with a 5 second auto-restart.

The script does **not** open the firewall. It prints a Private-profile rule for TCP 8188 limited to the LAN. Do not publish 8188 on the internet.

## Dreamscape config

On the Dreamscape host, in gitignored `secure.config.json` (never commit this file or the key):

```json
"localWorker": {
  "url": "http://<ruiko-lan-ip>:8188",
  "key": "<contents of F:\\dreamscape-worker\\worker.key>"
}
```

`localWorker.url` and `localWorker.key` are read only from the secure config. There is no public `config.json` switch.

## Run without NSSM

```powershell
$env:RUIKO_WORKER_KEY_FILE = "F:\dreamscape-worker\worker.key"
$env:RUIKO_MODEL_DIR = "F:\dreamscape-worker\models"
F:\dreamscape-worker\venv\Scripts\python.exe -m uvicorn ruiko_upscaler.app:app --host 0.0.0.0 --port 8188
```

## Test

Unit tests mock the model and do not need a GPU or the weight files:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:RUIKO_WORKER_KEY = "test-key"
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

On Linux or macOS, use `python3 -m venv .venv` and `.venv/bin/python`.

Smoke test against a running worker:

```powershell
$key = Get-Content F:\dreamscape-worker\worker.key
curl.exe http://127.0.0.1:8188/health
curl.exe -H "Authorization: Bearer $key" http://127.0.0.1:8188/models
```
