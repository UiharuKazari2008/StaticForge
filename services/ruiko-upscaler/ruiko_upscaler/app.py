"""FastAPI job API. One in-flight upscale, FIFO queue, bearer auth."""

import asyncio
import base64
import io
import os
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from ruiko_upscaler import infer, infer_animate
from ruiko_upscaler.auth import authorized, load_worker_key
from ruiko_upscaler.catalog import (
    ALLOWED_BACKENDS,
    ALLOWED_SCALES,
    DEFAULT_BACKEND,
    DEFAULT_FPS,
    DEFAULT_FRAMES,
    DEFAULT_MODEL,
    MAX_FPS,
    MAX_FRAMES,
    MIN_FPS,
    MIN_FRAMES,
    MODEL_LIST,
    MODELS,
)
from ruiko_upscaler import VERSION

MAX_BYTES = 32 * 1024 * 1024
MAX_EDGE = 4096
MAX_QUEUE = 16
JOB_TYPES = ("upscale", "animate")
RESULT_FORMATS = {"gif": "image/gif", "mp4": "video/mp4", "webp": "image/webp"}


def _env_int(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def job_ttl_seconds():
    return _env_int("RUIKO_JOB_TTL_SECONDS", 3600)


def sweep_seconds():
    return _env_int("RUIKO_SWEEP_SECONDS", 30)


class Job:
    def __init__(self, job_type, image, **fields):
        self.id = uuid.uuid4().hex
        self.type = job_type
        self.image = image
        self.model = fields.get("model")
        self.scale = fields.get("scale")
        self.motion_prompt = fields.get("motion_prompt")
        self.frames = fields.get("frames")
        self.fps = fields.get("fps")
        self.loop = fields.get("loop")
        self.backend = fields.get("backend")
        self.status = "queued"
        self.progress = 0
        self.error = None
        self.result = None
        self.created = time.time()
        self.finished = None

    def public(self):
        base = {
            "job_id": self.id,
            "type": self.type,
            "status": self.status,
            "progress": self.progress,
            "error": self.error,
        }
        if self.type == "animate":
            base.update({
                "motion_prompt": self.motion_prompt,
                "frames": self.frames,
                "fps": self.fps,
                "loop": self.loop,
                "backend": self.backend,
            })
        else:
            base.update({"model": self.model, "scale": self.scale})
        return base


def sweep_jobs(jobs, now=None, ttl=None):
    moment = time.time() if now is None else now
    limit = job_ttl_seconds() if ttl is None else ttl
    dead = []
    for job_id, job in jobs.items():
        if job.finished is not None and (moment - job.finished) >= limit:
            dead.append(job_id)
    for job_id in dead:
        del jobs[job_id]
    return len(dead)


def queue_length(jobs):
    return sum(1 for job in jobs.values() if job.status in ("queued", "running"))


def _decode_image(raw):
    if raw is None:
        raise ValueError("image is required")
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("data:"):
            text = text.split(",", 1)[1]
        try:
            data = base64.b64decode(text, validate=True)
        except Exception as exc:
            raise ValueError("image is not valid base64") from exc
    else:
        data = bytes(raw)
    if not data:
        raise ValueError("image is empty")
    if len(data) > MAX_BYTES:
        raise ValueError("image exceeds 32 MB")
    return data


def _check_dimensions(data):
    from PIL import Image
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as exc:
        raise ValueError("image could not be decoded") from exc
    width, height = image.size
    if width < 1 or height < 1 or max(width, height) > MAX_EDGE:
        raise ValueError("image edge must be 1..4096")
    return data


def _parse_scale(value):
    if value is None or value == "":
        return 4
    try:
        scale = int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("scale must be 2 or 4") from exc
    if scale not in ALLOWED_SCALES:
        raise ValueError("scale must be 2 or 4")
    return scale


def _parse_model(value):
    model = (value or DEFAULT_MODEL).strip()
    if model not in MODELS:
        raise ValueError("unknown model: {0}".format(model))
    return model


def _parse_job_type(value):
    job_type = (value or "upscale").strip().lower()
    if job_type not in JOB_TYPES:
        raise ValueError("type must be one of: {0}".format(", ".join(JOB_TYPES)))
    return job_type


def _parse_motion_prompt(value):
    text = (value or "").strip()
    if not text:
        raise ValueError("motion_prompt is required")
    if len(text) > 2000:
        raise ValueError("motion_prompt must be 2000 characters or fewer")
    return text


def _parse_ranged_int(value, default, minimum, maximum, label):
    if value is None or value == "":
        return default
    try:
        parsed = int(float(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("{0} must be an integer".format(label)) from exc
    if parsed < minimum or parsed > maximum:
        raise ValueError("{0} must be between {1} and {2}".format(label, minimum, maximum))
    return parsed


def _parse_frames(value):
    return _parse_ranged_int(value, DEFAULT_FRAMES, MIN_FRAMES, MAX_FRAMES, "frames")


def _parse_fps(value):
    return _parse_ranged_int(value, DEFAULT_FPS, MIN_FPS, MAX_FPS, "fps")


def _parse_loop(value):
    if value is None or value == "":
        return True
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _parse_backend(value):
    backend = (value or DEFAULT_BACKEND).strip().lower()
    if backend not in ALLOWED_BACKENDS:
        raise ValueError("backend must be one of: {0}".format(", ".join(ALLOWED_BACKENDS)))
    return backend


def _animate_fields(get):
    return {
        "type": "animate",
        "motion_prompt": _parse_motion_prompt(get("motion_prompt")),
        "frames": _parse_frames(get("frames")),
        "fps": _parse_fps(get("fps")),
        "loop": _parse_loop(get("loop")),
        "backend": _parse_backend(get("backend")),
    }


def _upscale_fields(get):
    return {
        "type": "upscale",
        "model": _parse_model(get("model")),
        "scale": _parse_scale(get("scale")),
    }


async def _read_job_fields(request):
    ctype = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in ctype:
        form = await request.form()
        upload = form.get("image") or form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise ValueError("image file is required")
        data = await upload.read()
        if isinstance(data, str):
            data = data.encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError("image exceeds 32 MB")
        _check_dimensions(data)
        job_type = _parse_job_type(form.get("type"))
        fields = _animate_fields(form.get) if job_type == "animate" else _upscale_fields(form.get)
        return data, fields
    body = await request.json()
    if not isinstance(body, dict):
        raise ValueError("JSON object required")
    data = _check_dimensions(_decode_image(body.get("image")))
    job_type = _parse_job_type(body.get("type"))
    fields = _animate_fields(body.get) if job_type == "animate" else _upscale_fields(body.get)
    return data, fields


def _loaded_kind_for(job):
    if job.type == "animate":
        return "animate:{0}".format(job.backend)
    return "upscale"


def _ensure_vram_for(app, job):
    """Only one of the upscaler or an animate backend lives in VRAM at a time."""
    target = _loaded_kind_for(job)
    current = app.state.loaded_kind
    if current == target:
        return
    if current == "upscale":
        infer.unload_models()
    elif current and current.startswith("animate:"):
        infer_animate.unload_pipelines()
    app.state.loaded_kind = target


async def worker_loop(app):
    while not app.state.stop.is_set():
        try:
            job = await asyncio.wait_for(app.state.queue.get(), timeout=0.5)
        except asyncio.TimeoutError:
            continue
        if job.status == "cancelled":
            app.state.queue.task_done()
            continue
        job.status = "running"
        job.progress = 5

        def on_progress(value):
            job.progress = max(job.progress, min(99, int(value)))

        try:
            _ensure_vram_for(app, job)
            if job.type == "animate":
                job.result = await asyncio.to_thread(
                    infer_animate.generate_animation_bytes,
                    job.image, job.motion_prompt, job.frames, job.fps, job.loop, job.backend, on_progress,
                )
            else:
                job.result = await asyncio.to_thread(
                    infer.upscale_image_bytes, job.image, job.model, job.scale, on_progress
                )
            job.status = "completed"
            job.progress = 100
            job.error = None
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc) or type(exc).__name__
        finally:
            job.image = None
            job.finished = time.time()
            app.state.queue.task_done()


async def sweep_loop(app):
    while not app.state.stop.is_set():
        try:
            await asyncio.wait_for(app.state.stop.wait(), timeout=max(1, sweep_seconds()))
        except asyncio.TimeoutError:
            sweep_jobs(app.state.jobs)


@asynccontextmanager
async def lifespan(app):
    app.state.jobs = {}
    app.state.queue = asyncio.Queue()
    app.state.stop = asyncio.Event()
    app.state.loaded_kind = None
    app.state.worker = asyncio.create_task(worker_loop(app))
    app.state.sweeper = asyncio.create_task(sweep_loop(app))
    try:
        yield
    finally:
        app.state.stop.set()
        app.state.worker.cancel()
        app.state.sweeper.cancel()
        for task in (app.state.worker, app.state.sweeper):
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="Ruiko upscaler", version=VERSION, lifespan=lifespan)


def _auth_or_response(request):
    if not load_worker_key():
        return JSONResponse({"error": "worker key is not configured"}, status_code=503)
    if not authorized(request.headers.get("authorization")):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return None


@app.get("/health")
async def health(request: Request):
    """Unauthenticated callers get a minimal probe. Bearer gets GPU and queue."""
    minimal = {
        "ok": True,
        "service": "ruiko-upscaler",
        "version": VERSION,
        "auth": "required",
        "job_types": list(JOB_TYPES),
    }
    if not authorized(request.headers.get("authorization")):
        return minimal
    gpu = infer.gpu_status()
    return {
        "ok": True,
        "service": "ruiko-upscaler",
        "version": VERSION,
        "auth": "ok",
        "gpu": gpu.get("name"),
        "cuda": gpu.get("cuda"),
        "vram_total_mb": gpu.get("vram_total_mb"),
        "vram_free_mb": gpu.get("vram_free_mb"),
        "queue_length": queue_length(app.state.jobs),
        "loaded_models": infer.loaded_model_ids(),
        "job_types": list(JOB_TYPES),
        "animate_backends": list(ALLOWED_BACKENDS),
        "animate_loaded": infer_animate.loaded_backend_ids(),
    }


@app.get("/models")
async def models(request: Request, type: str = "upscale"):
    denied = _auth_or_response(request)
    if denied:
        return denied
    kind = (type or "upscale").strip().lower()
    if kind == "animate":
        return {
            "backends": [
                {
                    "id": "animatediff",
                    "name": "AnimateDiff (SD1.5)",
                    "max_edge": infer_animate.ANIMATEDIFF_MAX_EDGE,
                },
                {
                    "id": "wan",
                    "name": "Wan 2.1 1.3B (480p, experimental)",
                    "max_edge": infer_animate.WAN_MAX_EDGE,
                },
            ],
            "default_backend": DEFAULT_BACKEND,
            "default_frames": DEFAULT_FRAMES,
            "default_fps": DEFAULT_FPS,
        }
    return {
        "models": [
            {"id": entry["id"], "name": entry["name"], "scale": entry["scale"]}
            for entry in MODEL_LIST
        ]
    }


@app.post("/jobs")
async def create_job(request: Request):
    denied = _auth_or_response(request)
    if denied:
        return denied
    if queue_length(app.state.jobs) >= MAX_QUEUE:
        return JSONResponse({"error": "queue is full"}, status_code=429)
    try:
        data, fields = await _read_job_fields(request)
    except ValueError as exc:
        status = 413 if "32 MB" in str(exc) else 400
        return JSONResponse({"error": str(exc)}, status_code=status)
    job_type = fields.pop("type")
    job = Job(job_type, data, **fields)
    app.state.jobs[job.id] = job
    await app.state.queue.put(job)
    return {"job_id": job.id}


@app.get("/jobs/{job_id}")
async def job_status(job_id: str, request: Request):
    denied = _auth_or_response(request)
    if denied:
        return denied
    job = app.state.jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "job not found"}, status_code=404)
    return job.public()


@app.get("/jobs/{job_id}/result")
async def job_result(job_id: str, request: Request, format: str = "gif"):
    denied = _auth_or_response(request)
    if denied:
        return denied
    job = app.state.jobs.get(job_id)
    if not job:
        return JSONResponse({"error": "job not found"}, status_code=404)
    if job.status == "failed":
        return JSONResponse({"error": job.error or "failed", "job_id": job.id}, status_code=409)
    if job.status != "completed" or not job.result:
        return JSONResponse({"error": "job is not complete", "job_id": job.id, "status": job.status}, status_code=409)
    if job.type == "animate":
        fmt = (format or "gif").strip().lower()
        if fmt not in RESULT_FORMATS:
            return JSONResponse({"error": "format must be one of: gif, mp4, webp"}, status_code=400)
        content = job.result.get(fmt)
        if not content:
            return JSONResponse({"error": "format not available: {0}".format(fmt)}, status_code=404)
        return Response(content=content, media_type=RESULT_FORMATS[fmt])
    return Response(content=job.result, media_type="image/png")


def main():
    import uvicorn
    uvicorn.run("ruiko_upscaler.app:app", host="0.0.0.0", port=8188, log_level="info")


if __name__ == "__main__":
    main()
