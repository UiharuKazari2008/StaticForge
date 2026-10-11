"""GPU-free tests. Inference is mocked; tile OOM retry is real."""

import base64
import io
import os
import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ["RUIKO_WORKER_KEY"] = "test-key"
os.environ["RUIKO_JOB_TTL_SECONDS"] = "3600"

from fastapi.testclient import TestClient
from PIL import Image

from ruiko_upscaler import infer, infer_animate
from ruiko_upscaler.app import app, sweep_jobs
from ruiko_upscaler.auth import keys_match, presented_bearer


def tiny_png(width=2, height=2, color=(10, 20, 30)):
    image = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


class LtxFrameCountTests(unittest.TestCase):
    def test_rounds_up_not_down(self):
        # 16 must round UP to 17 (8*2+1), not down to 9 (8*1+1) — a floor
        # div here previously under-produced frames and failed fail-loud.
        self.assertEqual(infer_animate._ltx_frame_count(16), 17)

    def test_already_valid_stays(self):
        self.assertEqual(infer_animate._ltx_frame_count(9), 9)
        self.assertEqual(infer_animate._ltx_frame_count(17), 17)

    def test_clamps_below_minimum(self):
        self.assertEqual(infer_animate._ltx_frame_count(8), 9)

    def test_result_always_covers_request(self):
        for frames in range(8, 33):
            self.assertGreaterEqual(infer_animate._ltx_frame_count(frames), frames)


class TileTests(unittest.TestCase):
    def test_vram_ladder_for_8gb(self):
        self.assertEqual(infer.tiles_for_vram_mb(8192, True)[0], 256)
        self.assertEqual(infer.tiles_for_vram_mb(8192, False)[0], 128)
        self.assertEqual(infer.tiles_for_vram_mb(None, True)[0], 256)
        self.assertGreater(infer.tiles_for_vram_mb(16000, True)[0], 256)

    def test_overlap(self):
        self.assertEqual(infer.overlap_for(256), 32)
        self.assertEqual(infer.overlap_for(128), 16)

    def test_oom_retry_uses_smaller_tile(self):
        seen = []

        def run(tile):
            seen.append(tile)
            if tile > 128:
                raise RuntimeError("CUDA out of memory")
            return tile

        self.assertEqual(infer.call_with_smaller_tiles(run, (256, 128, 64)), 128)
        self.assertEqual(seen, [256, 128])

    def test_non_oom_does_not_retry(self):
        def run(_tile):
            raise ValueError("bad image")

        with self.assertRaises(ValueError):
            infer.call_with_smaller_tiles(run, (256, 128))

    def test_is_oom(self):
        self.assertTrue(infer.is_oom(RuntimeError("CUDA out of memory. Tried to allocate 2 GiB")))
        self.assertFalse(infer.is_oom(ValueError("nope")))


class AuthTests(unittest.TestCase):
    def test_bearer_parse_and_compare(self):
        self.assertEqual(presented_bearer("Bearer secret"), "secret")
        self.assertEqual(presented_bearer("bearer secret"), "secret")
        self.assertEqual(presented_bearer("Token secret"), "")
        self.assertTrue(keys_match("abc", "abc"))
        self.assertFalse(keys_match("abc", "abd"))
        self.assertFalse(keys_match("", "abc"))


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.png = tiny_png()
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        self.headers = {"Authorization": "Bearer test-key"}

        def fake(image, model, scale, progress=None):
            if progress:
                progress(50)
            return tiny_png(width=2 * int(scale), height=2 * int(scale), color=(1, 2, 3))

        self._orig = infer.upscale_image_bytes
        infer.upscale_image_bytes = fake

    def tearDown(self):
        infer.upscale_image_bytes = self._orig
        self._ctx.__exit__(None, None, None)

    def test_health_minimal_without_auth(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["auth"], "required")
        self.assertEqual(body["version"], "1.0.0")
        self.assertNotIn("gpu", body)
        self.assertNotIn("queue_length", body)

    def test_health_full_with_auth(self):
        res = self.client.get("/health", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["auth"], "ok")
        self.assertIn("queue_length", body)
        self.assertIn("loaded_models", body)
        self.assertIn("vram_total_mb", body)
        self.assertEqual(body["version"], "1.0.0")

    def test_models_require_auth(self):
        self.assertEqual(self.client.get("/models").status_code, 401)
        res = self.client.get("/models", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        ids = [row["id"] for row in res.json()["models"]]
        self.assertEqual(ids, [
            "RealESRGAN_x4plus",
            "RealESRGAN_x4plus_anime_6B",
            "4x-UltraSharp",
        ])

    def test_json_job_roundtrip(self):
        res = self.client.post("/jobs", headers={**self.headers, "Content-Type": "application/json"}, json={
            "image": base64.b64encode(self.png).decode("ascii"),
            "model": "4x-UltraSharp",
            "scale": 2,
        })
        self.assertEqual(res.status_code, 200)
        job_id = res.json()["job_id"]
        self.assertTrue(job_id)
        status = None
        for _ in range(50):
            status = self.client.get("/jobs/" + job_id, headers=self.headers).json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["model"], "4x-UltraSharp")
        self.assertEqual(status["scale"], 2)
        result = self.client.get("/jobs/" + job_id + "/result", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["content-type"], "image/png")
        self.assertTrue(result.content.startswith(b"\x89PNG"))

    def test_multipart_job(self):
        res = self.client.post(
            "/jobs",
            headers=self.headers,
            files={"image": ("in.png", self.png, "image/png")},
            data={"model": "RealESRGAN_x4plus", "scale": "4"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("job_id", res.json())

    def test_rejects_bad_scale_and_model(self):
        payload = {"image": base64.b64encode(self.png).decode("ascii"), "scale": 3}
        res = self.client.post("/jobs", headers=self.headers, json=payload)
        self.assertEqual(res.status_code, 400)
        payload = {"image": base64.b64encode(self.png).decode("ascii"), "model": "nope", "scale": 4}
        res = self.client.post("/jobs", headers=self.headers, json=payload)
        self.assertEqual(res.status_code, 400)

    def test_rejects_oversize(self):
        payload = {"image": base64.b64encode(b"\x00" * (33 * 1024 * 1024)).decode("ascii")}
        res = self.client.post("/jobs", headers=self.headers, json=payload)
        self.assertEqual(res.status_code, 413)

    def test_unauthorized(self):
        res = self.client.post("/jobs", headers={"Authorization": "Bearer wrong"}, json={
            "image": base64.b64encode(self.png).decode("ascii"),
        })
        self.assertEqual(res.status_code, 401)

    def test_fifo_concurrency_one(self):
        gate = threading.Event()
        started = threading.Event()
        state = {"n": 0}

        def fake(image, model, scale, progress=None):
            state["n"] += 1
            if state["n"] == 1:
                started.set()
                if not gate.wait(5):
                    raise TimeoutError("gate")
            return tiny_png()

        infer.upscale_image_bytes = fake
        first = self.client.post("/jobs", headers=self.headers, json={
            "image": base64.b64encode(self.png).decode("ascii"),
            "model": "RealESRGAN_x4plus",
            "scale": 4,
        })
        self.assertTrue(started.wait(2))
        second = self.client.post("/jobs", headers=self.headers, json={
            "image": base64.b64encode(self.png).decode("ascii"),
            "model": "RealESRGAN_x4plus",
            "scale": 4,
        })
        second_id = second.json()["job_id"]
        mid = self.client.get("/jobs/" + second_id, headers=self.headers).json()
        self.assertEqual(mid["status"], "queued")
        gate.set()
        for job_id in (first.json()["job_id"], second_id):
            done = None
            for _ in range(50):
                done = self.client.get("/jobs/" + job_id, headers=self.headers).json()
                if done["status"] in ("completed", "failed"):
                    break
                time.sleep(0.05)
            self.assertEqual(done["status"], "completed")

    def test_ttl_sweep(self):
        jobs = {}

        class Stub:
            def __init__(self):
                self.finished = time.time() - 10
                self.status = "completed"

        jobs["old"] = Stub()
        jobs["new"] = Stub()
        jobs["new"].finished = time.time()
        removed = sweep_jobs(jobs, ttl=5)
        self.assertEqual(removed, 1)
        self.assertNotIn("old", jobs)
        self.assertIn("new", jobs)


class AnimateApiTests(unittest.TestCase):
    def setUp(self):
        self.png = tiny_png()
        self._ctx = TestClient(app)
        self.client = self._ctx.__enter__()
        self.headers = {"Authorization": "Bearer test-key"}

        def fake(image, motion_prompt, frames, fps, loop, backend, progress=None):
            if progress:
                progress(50)
            return {
                "gif": b"GIF89a" + b"\x00" * 8,
                "mp4": b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 8,
                "webp": b"RIFF" + b"\x00" * 8 + b"WEBP",
            }

        self._orig = infer_animate.generate_animation_bytes
        infer_animate.generate_animation_bytes = fake

    def tearDown(self):
        infer_animate.generate_animation_bytes = self._orig
        self._ctx.__exit__(None, None, None)

    def _post_animate(self, **overrides):
        payload = {
            "type": "animate",
            "image": base64.b64encode(self.png).decode("ascii"),
            "motion_prompt": "the character waves",
        }
        payload.update(overrides)
        return self.client.post("/jobs", headers=self.headers, json=payload)

    def test_animate_job_roundtrip_defaults(self):
        res = self._post_animate()
        self.assertEqual(res.status_code, 200)
        job_id = res.json()["job_id"]
        status = None
        for _ in range(50):
            status = self.client.get("/jobs/" + job_id, headers=self.headers).json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["type"], "animate")
        self.assertEqual(status["motion_prompt"], "the character waves")
        self.assertEqual(status["frames"], 16)
        self.assertEqual(status["fps"], 8)
        self.assertTrue(status["loop"])
        self.assertEqual(status["backend"], "ltx")

        gif = self.client.get("/jobs/" + job_id + "/result", headers=self.headers)
        self.assertEqual(gif.status_code, 200)
        self.assertEqual(gif.headers["content-type"], "image/gif")
        self.assertTrue(gif.content.startswith(b"GIF89a"))

        mp4 = self.client.get("/jobs/" + job_id + "/result?format=mp4", headers=self.headers)
        self.assertEqual(mp4.status_code, 200)
        self.assertEqual(mp4.headers["content-type"], "video/mp4")

        webp = self.client.get("/jobs/" + job_id + "/result?format=webp", headers=self.headers)
        self.assertEqual(webp.status_code, 200)
        self.assertEqual(webp.headers["content-type"], "image/webp")

    def test_animate_custom_fields_and_backend(self):
        res = self._post_animate(frames=24, fps=12, loop=False, backend="wan")
        self.assertEqual(res.status_code, 200)
        job_id = res.json()["job_id"]
        status = None
        for _ in range(50):
            status = self.client.get("/jobs/" + job_id, headers=self.headers).json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["frames"], 24)
        self.assertEqual(status["fps"], 12)
        self.assertFalse(status["loop"])
        self.assertEqual(status["backend"], "wan")

    def test_animate_requires_motion_prompt(self):
        payload = {"type": "animate", "image": base64.b64encode(self.png).decode("ascii")}
        res = self.client.post("/jobs", headers=self.headers, json=payload)
        self.assertEqual(res.status_code, 400)

    def test_animate_rejects_bad_backend(self):
        res = self._post_animate(backend="nope")
        self.assertEqual(res.status_code, 400)

    def test_animate_rejects_out_of_range_frames_and_fps(self):
        self.assertEqual(self._post_animate(frames=200).status_code, 400)
        self.assertEqual(self._post_animate(fps=1).status_code, 400)

    def test_animate_result_format_must_be_known(self):
        res = self._post_animate()
        job_id = res.json()["job_id"]
        for _ in range(50):
            status = self.client.get("/jobs/" + job_id, headers=self.headers).json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        bad = self.client.get("/jobs/" + job_id + "/result?format=bmp", headers=self.headers)
        self.assertEqual(bad.status_code, 400)

    def test_animate_multipart_job(self):
        res = self.client.post(
            "/jobs",
            headers=self.headers,
            files={"image": ("in.png", self.png, "image/png")},
            data={"type": "animate", "motion_prompt": "slow zoom", "frames": "8", "fps": "6"},
        )
        self.assertEqual(res.status_code, 200)

    def test_health_lists_animate_job_type(self):
        res = self.client.get("/health", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("animate", body["job_types"])
        self.assertIn("loop", body["animate_backends"])

    def test_models_animate_backends(self):
        res = self.client.get("/models?type=animate", headers=self.headers)
        self.assertEqual(res.status_code, 200)
        ids = [row["id"] for row in res.json()["backends"]]
        self.assertEqual(ids, ["loop", "wan", "ltx"])

    def test_animate_ltx_backend(self):
        res = self._post_animate(backend="ltx")
        self.assertEqual(res.status_code, 200)
        job_id = res.json()["job_id"]
        status = None
        for _ in range(50):
            status = self.client.get("/jobs/" + job_id, headers=self.headers).json()
            if status["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)
        self.assertEqual(status["status"], "completed")
        self.assertEqual(status["backend"], "ltx")


if __name__ == "__main__":
    unittest.main()
