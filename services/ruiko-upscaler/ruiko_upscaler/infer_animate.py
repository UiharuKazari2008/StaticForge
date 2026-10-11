"""AnimateDiff / Wan image-to-video inference sized for an 8 GB RTX 2070 Super.

Diffusers and torch import only when a real animation runs. Tests mock
generate_animation_bytes and exercise request validation without a GPU.

Wan is lazily loaded on first use and is never held in VRAM at the same time
as AnimateDiff or the upscaler; app.py unloads the previous backend before
switching (see _ensure_vram_for).
"""

import io
import os
import tempfile

from ruiko_upscaler.catalog import model_dir

ANIMATEDIFF_BASE_MODEL = os.environ.get("RUIKO_ANIMATEDIFF_BASE", "stablediffusionapi/anything-v5")
ANIMATEDIFF_MOTION_ADAPTER = "guoyww/animatediff-motion-adapter-v1-5-2"
WAN_MODEL = "Wan-AI/Wan2.1-T2V-1.3B-Diffusers"

ANIMATEDIFF_MAX_EDGE = 512
WAN_MAX_EDGE = 480

_pipelines = {}


def loaded_backend_ids():
    return list(_pipelines.keys())


def unload_pipelines():
    for pipeline in _pipelines.values():
        try:
            pipeline.to("cpu")
        except Exception:
            pass
    _pipelines.clear()
    _empty_cuda_cache()


def _empty_cuda_cache():
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _hf_cache_dir():
    path = os.path.join(model_dir(), "hf-cache")
    os.makedirs(path, exist_ok=True)
    return path


def _fit_dims(width, height, max_edge):
    """Scale to fit max_edge, rounded to a multiple of 8 for the SD/Wan VAE."""
    scale = min(1.0, float(max_edge) / float(max(width, height)))
    new_w = max(8, int(round(width * scale / 8.0)) * 8)
    new_h = max(8, int(round(height * scale / 8.0)) * 8)
    return new_w, new_h


def _load_animatediff_pipeline():
    cached = _pipelines.get("animatediff")
    if cached is not None:
        return cached
    import torch
    from diffusers import AnimateDiffVideoToVideoPipeline, EulerAncestralDiscreteScheduler, MotionAdapter

    cache_dir = _hf_cache_dir()
    adapter = MotionAdapter.from_pretrained(
        ANIMATEDIFF_MOTION_ADAPTER, cache_dir=cache_dir, torch_dtype=torch.float16
    )
    pipeline = AnimateDiffVideoToVideoPipeline.from_pretrained(
        ANIMATEDIFF_BASE_MODEL, motion_adapter=adapter, cache_dir=cache_dir, torch_dtype=torch.float16
    )
    pipeline.scheduler = EulerAncestralDiscreteScheduler.from_config(pipeline.scheduler.config)
    pipeline.vae.enable_slicing()
    pipeline.vae.enable_tiling()
    pipeline.enable_attention_slicing()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pipeline.to(device)
    _pipelines["animatediff"] = pipeline
    return pipeline


def _load_wan_pipeline():
    cached = _pipelines.get("wan")
    if cached is not None:
        return cached
    import torch
    from diffusers import WanPipeline

    cache_dir = _hf_cache_dir()
    pipeline = WanPipeline.from_pretrained(WAN_MODEL, cache_dir=cache_dir, torch_dtype=torch.float16)
    pipeline.vae.enable_slicing()
    pipeline.enable_attention_slicing()
    # 1.3B still benefits from CPU offload on an 8 GB card once the VAE and
    # text encoder are counted alongside the transformer.
    pipeline.enable_model_cpu_offload()
    _pipelines["wan"] = pipeline
    return pipeline


def _run_animatediff(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=ANIMATEDIFF_MAX_EDGE)
    resized = image.resize((width, height))
    pipeline = _load_animatediff_pipeline()
    if progress:
        progress(15)
    # Image-conditioned via vid2vid: AnimateDiff has no official img2vid
    # pipeline, so the still is replicated into a "video" and partially
    # re-noised (strength<1) with the motion module guiding the diff.
    video = [resized] * frames
    output = pipeline(
        video=video,
        prompt=motion_prompt,
        strength=0.75,
        num_inference_steps=25,
        guidance_scale=7.5,
    )
    if progress:
        progress(85)
    return list(output.frames[0])


def _run_wan(image, motion_prompt, frames, fps, progress):
    """Wan 2.1 1.3B ships text-to-video only; the source image seeds the
    first-frame latent so motion stays anchored to it. Experimental —
    strength/steps need tuning against real output on Ruiko's GPU.
    """
    import numpy as np
    import torch

    width, height = _fit_dims(*image.size, max_edge=WAN_MAX_EDGE)
    resized = image.resize((width, height))
    pipeline = _load_wan_pipeline()
    if progress:
        progress(15)

    with torch.no_grad():
        array = (np.asarray(resized).astype("float32") / 127.5) - 1.0
        tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0).unsqueeze(2)
        tensor = tensor.to(pipeline.vae.device, dtype=pipeline.vae.dtype)
        first_latent = pipeline.vae.encode(tensor).latent_dist.sample()
        first_latent = first_latent * pipeline.vae.config.scaling_factor

    latent_frames = first_latent.shape[2]
    if latent_frames < frames:
        pad = first_latent[:, :, -1:].repeat(1, 1, frames - latent_frames, 1, 1)
        init_latents = torch.cat([first_latent, pad], dim=2)
    else:
        init_latents = first_latent[:, :, :frames]

    output = pipeline(
        prompt=motion_prompt,
        num_frames=frames,
        height=height,
        width=width,
        num_inference_steps=30,
        guidance_scale=5.0,
        latents=init_latents,
    )
    if progress:
        progress(85)
    return list(output.frames[0])


def _encode_gif(frames, fps, loop):
    from PIL import Image

    # One shared adaptive palette keeps 16 frames at 512px well under ~4 MB.
    rgb = [f.convert("RGB") for f in frames]
    palette_src = rgb[len(rgb) // 2].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    frames = [f.quantize(palette=palette_src, dither=Image.Dither.FLOYDSTEINBERG) for f in rgb]
    buf = io.BytesIO()
    frames[0].save(
        buf,
        optimize=True,
        disposal=1,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=int(round(1000.0 / max(1, fps))),
        loop=0 if loop else 1,
    )
    return buf.getvalue()


def _encode_webp(frames, fps, loop):
    buf = io.BytesIO()
    frames[0].save(
        buf,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=int(round(1000.0 / max(1, fps))),
        loop=0 if loop else 1,
        quality=90,
    )
    return buf.getvalue()


def _encode_mp4(frames, fps):
    import imageio.v2 as imageio
    import numpy as np

    handle = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    path = handle.name
    handle.close()
    try:
        writer = imageio.get_writer(path, format="FFMPEG", fps=fps, codec="libx264", pixelformat="yuv420p")
        try:
            for frame in frames:
                writer.append_data(np.asarray(frame.convert("RGB")))
        finally:
            writer.close()
        with open(path, "rb") as result_file:
            return result_file.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


class AnimationError(RuntimeError):
    pass


def _check_frames(out_frames, expected):
    """Fail loudly instead of returning a still dressed up as a GIF."""
    import numpy as np

    count = len(out_frames or [])
    if count < 2 or count != int(expected):
        raise AnimationError("animation produced {0} frames, expected {1}".format(count, expected))
    first = np.asarray(out_frames[0].convert("RGB"), dtype="int16")
    if all(np.abs(np.asarray(f.convert("RGB"), dtype="int16") - first).mean() < 0.5 for f in out_frames[1:]):
        raise AnimationError("animation frames are identical (no motion generated)")


def generate_animation_bytes(image_bytes, motion_prompt, frames, fps, loop, backend, progress=None):
    """Animate a still image. Returns {"gif": bytes, "mp4": bytes, "webp": bytes}."""
    from PIL import Image

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(image.size) > 4096:
        raise ValueError("image edge exceeds 4096")

    if backend == "wan":
        out_frames = _run_wan(image, motion_prompt, frames, fps, progress)
    else:
        out_frames = _run_animatediff(image, motion_prompt, frames, fps, progress)

    _check_frames(out_frames, frames)
    if progress:
        progress(90)
    result = {
        "gif": _encode_gif(out_frames, fps, loop),
        "webp": _encode_webp(out_frames, fps, loop),
        "mp4": _encode_mp4(out_frames, fps),
    }
    if progress:
        progress(100)
    return result
