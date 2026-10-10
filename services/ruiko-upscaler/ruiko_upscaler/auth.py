"""Bearer auth from RUIKO_WORKER_KEY or a key file."""

import hmac
import os


def key_file_path():
    configured = os.environ.get("RUIKO_WORKER_KEY_FILE", "").strip()
    if configured:
        return configured
    return os.path.join(os.getcwd(), "worker.key")


def load_worker_key():
    env = os.environ.get("RUIKO_WORKER_KEY", "").strip()
    if env:
        return env
    path = key_file_path()
    if path and os.path.isfile(path):
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return ""


def presented_bearer(authorization):
    if not authorization:
        return ""
    text = str(authorization).strip()
    if len(text) < 7 or text[:7].lower() != "bearer ":
        return ""
    return text[7:].strip()


def keys_match(presented, expected):
    if not presented or not expected:
        return False
    left = presented.encode("utf-8")
    right = expected.encode("utf-8")
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def authorized(authorization):
    expected = load_worker_key()
    if not expected:
        return False
    return keys_match(presented_bearer(authorization), expected)
