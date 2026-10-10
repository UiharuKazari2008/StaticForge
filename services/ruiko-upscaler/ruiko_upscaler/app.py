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

from ruiko_upscaler import infer
from ruiko_upscaler.auth import authorized, load_worker_key
from ruiko_upscaler.catalog import ALLOWED_SCALES, DEFAULT_MODEL, MODEL_LIST, MODELS
from ruiko_upscaler import VERSION

MAX_BYTES = 32 * 1024 * 1024
MAX_EDGE = 4096
MAX_QUEUE = 16


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
    def __init__(self, image, model, scale):
        self.id = uuid.uuid4().hex
        self.image = image
        self.model = model
        self.scale = scale
        self.status = "queued"
        self.progress = 0
        self.error = None
        self.result = None
        self.created = time.time()
        self.finished = None

    def public(self):
        return {
            "job_id": self.id,
            "status": self.status,
            "progress": self.progress,
            "error": self.error,
            "model": self.model,
            "scale": self.scale,
        }


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
        return data, _parse_model(form.get("model")), _parse_scale(form.get("scale"))
    body = await request.json()
    if not isinstance(body, dict):
        raise ValueError("JSON object required")
    data = _check_dimensions(_decode_image(body.get("image")))
    return data, _parse_model(body.get("model")), _parse_scale(body.get("scale"))


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
    }


@app.get("/models")
async def models(request: Request):
    denied = _auth_or_response(request)
    if denied:
        return denied
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
        data, model, scale = await _read_job_fields(request)
    except ValueError as exc:
        status = 413 if "32 MB" in str(exc) else 400
        return JSONResponse({"error": str(exc)}, status_code=status)
    job = Job(data, model, scale)
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
async def job_result(job_id: str, request: Request):
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
    return Response(content=job.result, media_type="image/png")


def main():
    import uvicorn
    uvicorn.run("ruiko_upscaler.app:app", host="0.0.0.0", port=8188, log_level="info")


if __name__ == "__main__":
    main()
