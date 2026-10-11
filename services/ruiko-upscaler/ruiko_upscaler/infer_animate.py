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
import traceback
import os
import tempfile

from ruiko_upscaler.catalog import model_dir

ANIMATEDIFF_BASE_MODEL = os.environ.get("RUIKO_ANIMATEDIFF_BASE", "stablediffusionapi/anything-v5")
ANIMATEDIFF_MOTION_ADAPTER = "guoyww/animatediff-motion-adapter-v1-5-2"
WAN_MODEL = os.environ.get("RUIKO_WAN_MODEL", "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers")
WAN_GGUF_REPO = os.environ.get("RUIKO_WAN_GGUF_REPO", "city96/Wan2.1-I2V-14B-480P-gguf")
WAN_GGUF_FILE = os.environ.get("RUIKO_WAN_GGUF_FILE", "wan2.1-i2v-14b-480p-Q4_K_M.gguf")
LTX_MODEL = os.environ.get("RUIKO_LTX_MODEL", "Lightricks/LTX-Video")
# Quality path (default): LTX-Video 0.9.8 13B distilled. The 13B transformer is a
# GGUF quant (QuantStack) run under block-level group offload so only one block
# sits in VRAM at a time; T5 is reused from the base LTX-Video repo cache.
# RUIKO_LTX_VARIANT=base restores the old 2B 0.9.1 path (the "before" baseline).
LTX_VARIANT = os.environ.get("RUIKO_LTX_VARIANT", "13b-distilled")
LTX13_REPO = os.environ.get("RUIKO_LTX13_REPO", "Lightricks/LTX-Video-0.9.8-13B-distilled")
LTX13_GGUF_REPO = os.environ.get("RUIKO_LTX13_GGUF_REPO", "QuantStack/LTXV-13B-0.9.8-distilled-GGUF")
LTX13_GGUF_FILE = os.environ.get("RUIKO_LTX13_GGUF_FILE", "LTXV-13B-0.9.8-distilled-Q8_0.gguf")
# Distilled schedule from the 0.9.8 model card (guidance off, low decode noise).
LTX13_TIMESTEPS = [1000, 993, 987, 981, 975, 909, 725, 0.03]
LTX_NEGATIVE = (
    "worst quality, low quality, blurry, out of focus, motion blur, smeared, jittery, "
    "inconsistent motion, distorted face, deformed hands, artifacts, watermark, text"
)
# Frame enhance: RealESRGAN anime 6B 4x then Lanczos back down (supersampled sharpen).
LTX_ENHANCE_MODEL = os.environ.get("RUIKO_LTX_ENHANCE_MODEL", "RealESRGAN_x4plus_anime_6B")
LTX_ENHANCE = os.environ.get("RUIKO_LTX_ENHANCE", "1") not in ("0", "false", "")

LOOP_MAX_EDGE = 512
WAN_MAX_EDGE = 480
LTX_MAX_EDGE = int(os.environ.get("RUIKO_LTX_MAX_EDGE", "768" if LTX_VARIANT != "base" else "512"))

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


# Cheap latent previews: no VAE decode (that would cost VRAM/time on an 8 GB
# card). SD1.5 latents have published latent->RGB factors; LTX/Wan latents
# get an approximate RGB from their first three channels, min/max normalized.
SD15_LATENT_RGB = [
    [0.3512, 0.2297, 0.3227],
    [0.3250, 0.4974, 0.2350],
    [-0.2829, 0.1762, 0.2721],
    [-0.2120, -0.2616, -0.7177],
]
PREVIEW_FRAMES = 6
PREVIEW_HEIGHT = 96


def _latents_to_strip(latents, sd15=False):
    """latents: tensor [B, C, F, H, W]. Returns JPEG bytes of a filmstrip."""
    import numpy as np
    from PIL import Image

    lat = latents[0].detach().float().cpu().numpy()  # C, F, H, W
    channels, count = lat.shape[0], lat.shape[1]
    picks = sorted(set(int(round(i * (count - 1) / max(1, PREVIEW_FRAMES - 1))) for i in range(min(PREVIEW_FRAMES, count))))
    tiles = []
    for idx in picks:
        frame = lat[:, idx]  # C, H, W
        if sd15 and channels == 4:
            rgb = np.einsum("chw,cr->hwr", frame, np.asarray(SD15_LATENT_RGB, dtype="float32"))
            rgb = np.clip((rgb + 1.0) * 127.5, 0, 255)
        else:
            rgb = np.transpose(frame[:3], (1, 2, 0))
            lo, hi = np.percentile(rgb, 2), np.percentile(rgb, 98)
            rgb = np.clip((rgb - lo) / max(1e-6, hi - lo) * 255.0, 0, 255)
        tile = Image.fromarray(rgb.astype("uint8"), "RGB")
        width = max(1, int(round(tile.width * PREVIEW_HEIGHT / float(tile.height))))
        tiles.append(tile.resize((width, PREVIEW_HEIGHT), Image.BILINEAR))
    return _strip_jpeg(tiles)


def _frames_to_strip(frames):
    from PIL import Image

    count = len(frames)
    picks = sorted(set(int(round(i * (count - 1) / max(1, PREVIEW_FRAMES - 1))) for i in range(min(PREVIEW_FRAMES, count))))
    tiles = []
    for idx in picks:
        tile = frames[idx].convert("RGB")
        width = max(1, int(round(tile.width * PREVIEW_HEIGHT / float(tile.height))))
        tiles.append(tile.resize((width, PREVIEW_HEIGHT), Image.BILINEAR))
    return _strip_jpeg(tiles)


def _strip_jpeg(tiles):
    from PIL import Image

    if not tiles:
        return None
    strip = Image.new("RGB", (sum(t.width for t in tiles) + 2 * (len(tiles) - 1), PREVIEW_HEIGHT), (0, 0, 0))
    x = 0
    for tile in tiles:
        strip.paste(tile, (x, 0))
        x += tile.width + 2
    buf = io.BytesIO()
    strip.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def _report(progress, pct, stage, step=None, total=None, preview=None):
    if not progress:
        return
    try:
        progress(pct, stage=stage, step=step, total=total, preview=preview)
    except TypeError:
        progress(pct)


def _step_callback(progress, total, to_strip, lo=10, hi=85):
    """diffusers callback_on_step_end: per-step progress + a latent preview every N steps."""
    every = max(1, total // 8)

    def callback(pipe, step_index, timestep, callback_kwargs):
        step = step_index + 1
        preview = None
        if step % every == 0 or step == total:
            try:
                preview = to_strip(pipe, callback_kwargs.get("latents"))
            except Exception:
                preview = None
        step = min(step, total)
        _report(progress, lo + (hi - lo) * step / float(total), "generating", step, total, preview)
        return callback_kwargs

    return callback


def _load_ltx13_pipeline():
    cached = _pipelines.get("ltx")
    if cached is not None:
        return cached
    import torch
    from diffusers import GGUFQuantizationConfig, LTXConditionPipeline, LTXVideoTransformer3DModel
    from diffusers.hooks import apply_group_offloading
    from huggingface_hub import hf_hub_download
    from transformers import T5EncoderModel

    cache_dir = _hf_cache_dir()
    gguf_path = hf_hub_download(LTX13_GGUF_REPO, LTX13_GGUF_FILE, cache_dir=cache_dir)
    transformer = LTXVideoTransformer3DModel.from_single_file(
        gguf_path,
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        torch_dtype=torch.bfloat16,
        config=LTX13_REPO,
        subfolder="transformer",
        cache_dir=cache_dir,
    )
    text_encoder = T5EncoderModel.from_pretrained(
        LTX_MODEL, subfolder="text_encoder", cache_dir=cache_dir, torch_dtype=torch.bfloat16
    )
    pipeline = LTXConditionPipeline.from_pretrained(
        LTX13_REPO, transformer=transformer, text_encoder=text_encoder,
        cache_dir=cache_dir, torch_dtype=torch.bfloat16,
    )
    pipeline.vae.enable_tiling()
    device = torch.device("cuda")
    cpu = torch.device("cpu")
    # GGUF params don't survive sequential offload's meta hook; group offload moves
    # whole blocks with .to(), which keeps the quant type.
    apply_group_offloading(transformer, onload_device=device, offload_device=cpu,
                           offload_type="block_level", num_blocks_per_group=1, use_stream=True)
    apply_group_offloading(text_encoder, onload_device=device, offload_device=cpu,
                           offload_type="block_level", num_blocks_per_group=1)
    pipeline.vae.to(device)
    _pipelines["ltx"] = pipeline
    return pipeline


def _enhance_frames(frames, progress):
    """RealESRGAN anime 6B 4x per frame, Lanczos back to the original size."""
    from PIL import Image
    from ruiko_upscaler import infer

    out = []
    for index, frame in enumerate(frames):
        buf = io.BytesIO()
        frame.convert("RGB").save(buf, format="PNG")
        up = infer.upscale_image_bytes(buf.getvalue(), LTX_ENHANCE_MODEL, 4)
        big = Image.open(io.BytesIO(up)).convert("RGB")
        out.append(big.resize(frame.size, Image.Resampling.LANCZOS))
        _report(progress, 85 + 3 * (index + 1) / float(len(frames)), "enhancing", index + 1, len(frames))
    infer.unload_models()
    return out


def _run_loop(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=LOOP_MAX_EDGE)
    resized = image.resize((width, height))
    _report(progress, 2, "loading model")
    pipeline = _load_loop_pipeline()
    steps = 25
    _report(progress, 10, "generating", 0, steps)
    # Image-conditioned via vid2vid: AnimateDiff has no official img2vid
    # pipeline, so the still is replicated into a "video" and partially
    # re-noised (strength<1) with the motion module guiding the diff. This
    # loops around the source rather than truly continuing the scene.
    video = [resized] * frames
    output = pipeline(
        video=video,
        prompt=motion_prompt,
        strength=0.75,
        num_inference_steps=steps,
        guidance_scale=7.5,
        callback_on_step_end=_step_callback(
            progress, int(steps * 0.75) or steps, lambda pipe, lat: _latents_to_strip(lat, sd15=True)
        ),
        callback_on_step_end_tensor_inputs=["latents"],
    )
    return list(output.frames[0])


def _run_wan(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=WAN_MAX_EDGE, multiple=16)
    resized = image.resize((width, height))
    _report(progress, 2, "loading model")
    pipeline = _load_wan_pipeline()
    steps = 30
    _report(progress, 10, "generating", 0, steps)
    output = pipeline(
        image=resized,
        prompt=motion_prompt,
        height=height,
        width=width,
        num_frames=frames,
        num_inference_steps=steps,
        guidance_scale=5.0,
        output_type="pil",
        callback_on_step_end=_step_callback(progress, steps, lambda pipe, lat: _latents_to_strip(lat)),
        callback_on_step_end_tensor_inputs=["latents"],
    )
    return list(output.frames[0])


def _ltx_frame_count(frames):
    """LTX's causal VAE needs num_frames = 8k+1; round UP (ceiling, not
    floor) to the next valid count so there are at least `frames` to trim
    back to."""
    return 8 * math.ceil((max(frames, 9) - 1) / 8) + 1


def _run_ltx(image, motion_prompt, frames, fps, progress):
    if LTX_VARIANT == "base":
        return _run_ltx_base(image, motion_prompt, frames, fps, progress)
    return _run_ltx13(image, motion_prompt, frames, fps, progress)


def _run_ltx13(image, motion_prompt, frames, fps, progress):
    from diffusers.pipelines.ltx.pipeline_ltx_condition import LTXVideoCondition

    width, height = _fit_dims(*image.size, max_edge=LTX_MAX_EDGE, multiple=32)
    resized = image.resize((width, height))
    _report(progress, 2, "loading model")
    pipeline = _load_ltx13_pipeline()
    ltx_frames = _ltx_frame_count(frames)
    steps = len(LTX13_TIMESTEPS)
    _report(progress, 10, "generating", 0, steps)

    def ltx_strip(pipe, lat):
        if lat is not None and lat.dim() == 3:
            lat = pipe._unpack_latents(
                lat, (ltx_frames - 1) // pipe.vae_temporal_compression_ratio + 1,
                height // pipe.vae_spatial_compression_ratio, width // pipe.vae_spatial_compression_ratio,
                pipe.transformer_spatial_patch_size, pipe.transformer_temporal_patch_size,
            )
        return _latents_to_strip(lat)

    output = pipeline(
        conditions=[LTXVideoCondition(image=resized, frame_index=0)],
        prompt=motion_prompt,
        negative_prompt=LTX_NEGATIVE,
        height=height,
        width=width,
        num_frames=ltx_frames,
        frame_rate=max(1, int(fps)),
        timesteps=LTX13_TIMESTEPS,
        guidance_scale=1.0,
        guidance_rescale=0.7,
        decode_timestep=0.05,
        decode_noise_scale=0.025,
        image_cond_noise_scale=0.0,
        output_type="pil",
        callback_on_step_end=_step_callback(progress, steps, ltx_strip, hi=82),
        callback_on_step_end_tensor_inputs=["latents"],
    )
    out_frames = list(output.frames[0])[:frames]
    if LTX_ENHANCE:
        try:
            out_frames = _enhance_frames(out_frames, progress)
        except Exception:
            # Enhance is optional polish; never lose a 30-minute generation to it.
            traceback.print_exc()
    return out_frames


def _run_ltx_base(image, motion_prompt, frames, fps, progress):
    width, height = _fit_dims(*image.size, max_edge=LTX_MAX_EDGE, multiple=32)
    resized = image.resize((width, height))
    _report(progress, 2, "loading model")
    pipeline = _load_ltx_pipeline()
    steps = 30
    ltx_frames = _ltx_frame_count(frames)
    _report(progress, 10, "generating", 0, steps)

    def ltx_strip(pipe, lat):
        # LTX latents are packed [B, seq, C]; unpack to [B, C, F, H, W].
        if lat is not None and lat.dim() == 3:
            lat = pipe._unpack_latents(
                lat, (ltx_frames - 1) // pipe.vae_temporal_compression_ratio + 1,
                height // pipe.vae_spatial_compression_ratio, width // pipe.vae_spatial_compression_ratio,
                pipe.transformer_spatial_patch_size, pipe.transformer_temporal_patch_size,
            )
        return _latents_to_strip(lat)

    output = pipeline(
        image=resized,
        prompt=motion_prompt,
        negative_prompt="worst quality, inconsistent motion, blurry, jittery, distorted",
        height=height,
        width=width,
        num_frames=ltx_frames,
        num_inference_steps=steps,
        output_type="pil",
        callback_on_step_end=_step_callback(progress, steps, ltx_strip),
        callback_on_step_end_tensor_inputs=["latents"],
    )
    return list(output.frames[0])[:frames]


def _encode_gif(frames, fps, loop):
    from PIL import Image

    # One shared adaptive palette keeps 16 frames at 512px well under ~4 MB.
    rgb = [f.convert("RGB") for f in frames]
    # Palette built from a mosaic of several frames so colors that appear mid-clip survive.
    picks = rgb[:: max(1, len(rgb) // 6)][:6]
    thumb_w, thumb_h = max(1, rgb[0].width // 2), max(1, rgb[0].height // 2)
    mosaic = Image.new("RGB", (thumb_w * len(picks), thumb_h))
    for i, frame in enumerate(picks):
        mosaic.paste(frame.resize((thumb_w, thumb_h)), (i * thumb_w, 0))
    palette_src = mosaic.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
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


def _encode_webm(frames, fps):
    """VP9 high quality (constant quality CRF 18) -- the primary result format."""
    return _encode_ffmpeg(frames, fps, ".webm", "libvpx-vp9",
                          ["-crf", "18", "-b:v", "0", "-deadline", "good", "-cpu-used", "1", "-row-mt", "1"])


def _encode_mp4(frames, fps):
    return _encode_ffmpeg(frames, fps, ".mp4", "libx264", ["-crf", "16", "-preset", "slow"])


def _encode_ffmpeg(frames, fps, suffix, codec, params):
    import imageio.v2 as imageio
    import numpy as np

    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    path = handle.name
    handle.close()
    try:
        writer = imageio.get_writer(path, format="FFMPEG", fps=fps, codec=codec, pixelformat="yuv420p",
                                    output_params=params, macro_block_size=1)
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
    try:
        final_strip = _frames_to_strip(out_frames)
    except Exception:
        final_strip = None
    _report(progress, 88, "encoding", 1, 3, final_strip)
    gif = _encode_gif(out_frames, fps, loop)
    _report(progress, 92, "encoding", 2, 3)
    webp = _encode_webp(out_frames, fps, loop)
    _report(progress, 96, "encoding", 3, 3)
    result = {"gif": gif, "webp": webp, "mp4": _encode_mp4(out_frames, fps)}
    try:
        result["webm"] = _encode_webm(out_frames, fps)
    except Exception:
        traceback.print_exc()
    _report(progress, 99, "encoding", 3, 3)
    return result
