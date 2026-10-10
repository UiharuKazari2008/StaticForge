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


def model_dir():
    configured = os.environ.get("RUIKO_MODEL_DIR", "").strip()
    if configured:
        return configured
    return os.path.join(_DIR, "models")
