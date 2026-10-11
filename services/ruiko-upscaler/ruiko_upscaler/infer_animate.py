"""Image-to-video inference sized for an 8 GB RTX 2070 Super: three modes.

- loop: AnimateDiff (SD1.5 + motion module), vid2vid-seeded from the still.
  Cheap and fast; loops rather than truly continuing the scene.
- wan: Wan 2.1 I2V 14B 480p, true image-to-video (WanImageToVideoPipeline).
  The 14B transformer is GGUF-quantized (city96 Q4/Q5) to fit VRAM; the rest
  of the pipeline runs under sequential CPU offload.
- ltx: LTX-Video I2V (LTXImageToVideoPipeline), also true image-to-video,
  smaller than Wan 14B; sequential CPU offload keeps it inside 8 GB too.

Diffusers and torch import only when a real animation runs. Tests mock
generate_animation_bytes and exercise request validation without a GPU.

wan/ltx are lazily loaded on first use and are never held in VRAM at the
same time as loop or the upscaler; app.py unloads the previous backend
before switching (see _ensure_vram_for).
"""

import io
import math
import os
import tempfile

from ruiko_upscaler.catalog import model_dir

ANIMATEDIFF_BASE_MODEL = os.environ.get("RUIKO_ANIMATEDIFF_BASE", "stablediffusionapi/anything-v5")
ANIMATEDIFF_MOTION_ADAPTER = "guoyww/animatediff-motion-adapter-v1-5-2"
WAN_MODEL = os.environ.get("RUIKO_WAN_MODEL", "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers")
WAN_GGUF_REPO = os.environ.get("RUIKO_WAN_GGUF_REPO", "city96/Wan2.1-I2V-14B-480P-gguf")
WAN_GGUF_FILE = os.environ.get("RUIKO_WAN_GGUF_FILE", "wan2.1-i2v-14b-480p-Q4_K_M.gguf")
LTX_MODEL = os.environ.get("RUIKO_LTX_MODEL", "Lightricks/LTX-Video")

LOOP_MAX_EDGE = 512
WAN_MAX_EDGE = 480
LTX_MAX_EDGE = 512

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


def _fit_dims(width, height, max_edge, multiple=8):
    """Scale to fit max_edge, rounded to a multiple of the VAE's temporal/spatial stride."""
    scale = min(1.0, float(max_edge) / float(max(width, height)))
    new_w = max(multiple, int(round(width * scale / multiple)) * multiple)
    new_h = max(multiple, int(round(height * scale / multiple)) * multiple)
    return new_w, new_h


def _load_loop_pipeline():
    cached = _pipelines.get("loop")
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
    _pipelines["loop"] = pipeline
    return pipeline


def _load_wan_pipeline():
    cached = _pipelines.get("wan")
    if cached is not None:
        return cached
    import torch
    from diffusers import GGUFQuantizationConfig, WanImageToVideoPipeline, WanTransformer3DModel
    from huggingface_hub import hf_hub_download

    cache_dir = _hf_cache_dir()
    gguf_path = hf_hub_download(WAN_GGUF_REPO, WAN_GGUF_FILE, cache_dir=cache_dir)
    # The 14B transformer is the part that can't fit an 8 GB card at full
    # precision; GGUF-quantize just that submodule and load the rest (VAE,
    # UMT5 text encoder, CLIP image encoder) from the reference repo.
    transformer = WanTransformer3DModel.from_single_file(
        gguf_path,
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        torch_dtype=torch.bfloat16,
        config=WAN_MODEL,
        subfolder="transformer",
    )
    pipeline = WanImageToVideoPipeline.from_pretrained(
        WAN_MODEL, transformer=transformer, cache_dir=cache_dir, torch_dtype=torch.bfloat16
    )
    pipeline.vae.enable_slicing()
    pipeline.vae.enable_tiling()
    # enable_sequential_cpu_offload() moves GGUFParameter tensors through a
    # meta-device hook that drops their quant_type (diffusers' GGUF dequant
    # table lookup then does KeyError: None) — GGUF-quantized pipelines need
    # the coarser whole-submodule offload instead.
    pipeline.enable_model_cpu_offload()
    _pipelines["wan"] = pipeline
    return pipeline


def _load_ltx_pipeline():
    cached = _pipelines.get("ltx")
    if cached is not None:
        return cached
    import torch
    from diffusers import LTXImageToVideoPipeline

    cache_dir = _hf_cache_dir()
    pipeline = LTXImageToVideoPipeline.from_pretrained(
        LTX_MODEL, cache_dir=cache_dir, torch_dtype=torch.bfloat16
    )
    pipeline.vae.enable_tiling()
    pipeline.enable_sequential_cpu_offload()
    _pipelines["ltx"] = pipeline
    return pipeline


def _run_loop(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=LOOP_MAX_EDGE)
    resized = image.resize((width, height))
    pipeline = _load_loop_pipeline()
    if progress:
        progress(15)
    # Image-conditioned via vid2vid: AnimateDiff has no official img2vid
    # pipeline, so the still is replicated into a "video" and partially
    # re-noised (strength<1) with the motion module guiding the diff. This
    # loops around the source rather than truly continuing the scene.
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
    width, height = _fit_dims(*image.size, max_edge=WAN_MAX_EDGE, multiple=16)
    resized = image.resize((width, height))
    pipeline = _load_wan_pipeline()
    if progress:
        progress(15)
    output = pipeline(
        image=resized,
        prompt=motion_prompt,
        height=height,
        width=width,
        num_frames=frames,
        num_inference_steps=30,
        guidance_scale=5.0,
        output_type="pil",
    )
    if progress:
        progress(85)
    return list(output.frames[0])


def _ltx_frame_count(frames):
    """LTX's causal VAE needs num_frames = 8k+1; round UP (ceiling, not
    floor) to the next valid count so there are at least `frames` to trim
    back to."""
    return 8 * math.ceil((max(frames, 9) - 1) / 8) + 1


def _run_ltx(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=LTX_MAX_EDGE, multiple=32)
    resized = image.resize((width, height))
    pipeline = _load_ltx_pipeline()
    if progress:
        progress(15)
    ltx_frames = _ltx_frame_count(frames)
    output = pipeline(
        image=resized,
        prompt=motion_prompt,
        negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted",
        height=height,
        width=width,
        num_frames=ltx_frames,
        num_inference_steps=30,
        output_type="pil",
    )
    if progress:
        progress(85)
    return list(output.frames[0])[:frames]


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
    elif backend == "ltx":
        out_frames = _run_ltx(image, motion_prompt, frames, fps, progress)
    else:
        out_frames = _run_loop(image, motion_prompt, frames, fps, progress)

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
