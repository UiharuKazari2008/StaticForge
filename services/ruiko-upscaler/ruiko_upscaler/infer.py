"""Tiled spandrel inference sized for an 8 GB RTX 2070 Super.

Torch and spandrel import only when a real upscale runs. Tests mock
upscale_image_bytes and exercise the tile ladder without a GPU.
"""

import os

from ruiko_upscaler.catalog import MODELS, model_dir

# fp16 tiles for <= 8 GB. fp32 starts smaller because activations do not fit.
TILES_FP16_8GB = (256, 192, 128, 96, 64)
TILES_FP32_8GB = (128, 96, 64)
TILES_10GB = (384, 256, 192, 128, 64)
TILES_16GB = (512, 384, 256, 128, 64)

_descriptors = {}
_loaded_ids = []


def loaded_model_ids():
    return list(_loaded_ids)


def tiles_for_vram_mb(vram_mb, half):
    """Tile sizes, largest first, that stay inside the given VRAM."""
    if vram_mb is not None and vram_mb >= 14000:
        return TILES_16GB
    if vram_mb is not None and vram_mb > 8192:
        return TILES_10GB
    if half:
        return TILES_FP16_8GB
    return TILES_FP32_8GB


def overlap_for(tile):
    if tile >= 256:
        return 32
    return 16


def is_oom(exc):
    if exc is None:
        return False
    name = type(exc).__name__
    if name in ("OutOfMemoryError", "CudaOutOfMemoryError"):
        return True
    text = str(exc).lower()
    if "out of memory" in text:
        return True
    if "cuda" in text and "memory" in text:
        return True
    return False


def empty_cuda_cache():
    try:
        import torch
    except ImportError:
        return
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def call_with_smaller_tiles(fn, tiles):
    """Run fn(tile). On OOM, drop the cache and retry the next smaller tile."""
    if not tiles:
        raise RuntimeError("no tile sizes")
    last = None
    for tile in tiles:
        try:
            return fn(tile)
        except Exception as exc:
            if not is_oom(exc):
                raise
            last = exc
            empty_cuda_cache()
    raise RuntimeError("out of memory after smaller tiles: {0}".format(last)) from last


def gpu_status():
    try:
        import torch
    except ImportError:
        return {"name": None, "vram_total_mb": None, "vram_free_mb": None, "cuda": False}
    if not torch.cuda.is_available():
        return {"name": None, "vram_total_mb": None, "vram_free_mb": None, "cuda": False}
    props = torch.cuda.get_device_properties(0)
    free, total = torch.cuda.mem_get_info(0)
    name = props.name
    if isinstance(name, bytes):
        name = name.decode("utf-8", "replace")
    return {
        "name": str(name),
        "vram_total_mb": int(total // (1024 * 1024)),
        "vram_free_mb": int(free // (1024 * 1024)),
        "cuda": True,
    }


def _remember(model_id):
    if model_id not in _loaded_ids:
        _loaded_ids.append(model_id)


def get_descriptor(model_id):
    cached = _descriptors.get(model_id)
    if cached is not None:
        return cached
    spec = MODELS.get(model_id)
    if not spec:
        raise ValueError("unknown model: {0}".format(model_id))
    path = os.path.join(model_dir(), spec["file"])
    if not os.path.isfile(path):
        raise FileNotFoundError("model file missing: {0}".format(path))
    from spandrel import ModelLoader
    descriptor = ModelLoader().load_from_file(path)
    _descriptors[model_id] = descriptor
    _remember(model_id)
    return descriptor


def _to_hwc(tensor):
    import numpy as np
    array = tensor.detach().float().cpu().clamp(0, 1)
    if array.ndim == 4:
        array = array[0]
    return array.permute(1, 2, 0).numpy()


def _forward_tiles(model, tensor, tile, overlap, device, use_half, scale):
    import torch
    _, _, height, width = tensor.shape
    scale = int(scale)
    if height <= tile and width <= tile:
        with torch.inference_mode():
            out = model(tensor.to(device))
        return _to_hwc(out)

    import numpy as np
    stride = max(1, tile - overlap)
    out_h = height * scale
    out_w = width * scale
    accum = np.zeros((out_h, out_w, 3), dtype="float32")
    weight = np.zeros((out_h, out_w, 1), dtype="float32")
    ys = list(range(0, max(height - overlap, 1), stride))
    xs = list(range(0, max(width - overlap, 1), stride))
    if not ys:
        ys = [0]
    if not xs:
        xs = [0]
    if ys[-1] + tile < height:
        ys.append(max(0, height - tile))
    if xs[-1] + tile < width:
        xs.append(max(0, width - tile))

    for top in ys:
        for left in xs:
            bottom = min(top + tile, height)
            right = min(left + tile, width)
            crop = tensor[:, :, top:bottom, left:right]
            with torch.inference_mode():
                pred = model(crop.to(device))
            piece = _to_hwc(pred)
            ph, pw = piece.shape[0], piece.shape[1]
            ot = top * scale
            ol = left * scale
            accum[ot:ot + ph, ol:ol + pw, :] += piece
            weight[ot:ot + ph, ol:ol + pw, :] += 1.0
            del pred
    weight[weight == 0] = 1.0
    return accum / weight


def upscale_image_bytes(image_bytes, model_id, scale, progress=None):
    """Upscale PNG/JPEG bytes. Native model scale is 4; other scales resize after."""
    import io
    import numpy as np
    import torch
    from PIL import Image

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    width, height = image.size
    if max(width, height) > 4096:
        raise ValueError("image edge exceeds 4096")
    descriptor = get_descriptor(model_id)
    native = int(getattr(descriptor, "scale", 4) or 4)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    use_half = device.type == "cuda" and bool(getattr(descriptor, "supports_half", False))
    model = descriptor.model
    model.eval()
    if use_half:
        model.half()
    model.to(device)
    _remember(model_id)

    vram = None
    if device.type == "cuda":
        vram = int(torch.cuda.get_device_properties(0).total_memory // (1024 * 1024))
    tiles = tiles_for_vram_mb(vram, use_half)

    array = np.asarray(image).astype("float32") / 255.0
    tensor = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0)
    tensor = tensor.half() if use_half else tensor.float()

    def run(tile):
        if progress:
            progress(10)
        return _forward_tiles(model, tensor, tile, overlap_for(tile), device, use_half, native)

    out = call_with_smaller_tiles(run, tiles)
    if progress:
        progress(90)
    out_img = Image.fromarray(np.clip(out * 255.0, 0, 255).astype("uint8"), "RGB")
    target_w = max(1, int(round(width * float(scale))))
    target_h = max(1, int(round(height * float(scale))))
    if out_img.size != (target_w, target_h):
        out_img = out_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    if progress:
        progress(100)
    return buf.getvalue()
