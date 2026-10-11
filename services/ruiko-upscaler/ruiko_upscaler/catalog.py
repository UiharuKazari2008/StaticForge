"""Model catalog shared with install.ps1 (models.json)."""

import json
import os

_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CATALOG_PATH = os.path.join(_DIR, "models.json")

with open(_CATALOG_PATH, "r", encoding="utf-8") as _fh:
    MODEL_LIST = json.load(_fh)

MODELS = {entry["id"]: entry for entry in MODEL_LIST}
DEFAULT_MODEL = "RealESRGAN_x4plus"
ALLOWED_SCALES = (2, 4)

# Animate job type: loop (AnimateDiff, fast), wan (Wan 2.1 I2V 14B, true
# image-to-video), ltx (LTX-Video I2V, true image-to-video). Kept separate
# from the upscale model catalog above since these are backends, not weight
# files. ltx is the default: it's the best *working* true image-to-video
# mode on an 8 GB card. wan is real I2V too but on this hardware a single
# 16-frame clip ran 2.5+ hours without finishing under enable_model_cpu_offload
# (required because GGUF-quantized params don't survive sequential offload's
# meta-device hook) — see services/ruiko-upscaler bakeoff notes.
ALLOWED_BACKENDS = ("loop", "wan", "ltx")
DEFAULT_BACKEND = "ltx"
DEFAULT_FRAMES = 16
MIN_FRAMES = 8
MAX_FRAMES = 32
DEFAULT_FPS = 8
MIN_FPS = 4
MAX_FPS = 24


def model_dir():
    configured = os.environ.get("RUIKO_MODEL_DIR", "").strip()
    if configured:
        return configured
    return os.path.join(_DIR, "models")
