"""trayeye-vision: локальный сервис камеры для TrayEye (только 127.0.0.1).

Node-сервер TrayEye присылает сюда видео (путь к файлу в папке входящих) или
отдельные кадры с живой камеры. Сервис находит подносы моделью YOLOE (ONNX, без
токенов) и возвращает по каждому подносу вырезанный кадр и локальную оценку:
пусто -> ChatGPT не нужен, есть остатки -> Node отправит кадр в ChatGPT.

Однопоточный намеренно: запросы идут по очереди и занимают одно ядро, чтобы не
мешать API, Postgres и ботам на том же слабом сервере.

    GET  /health
    POST /video   {"path": "<файл в CAMERA_INBOX>", "fps": 3}
    POST /image   тело - JPEG одного фото (повар в боте); ответ - подносы на фото
    POST /frame?camera=<id>&ts=<секунды>   тело - JPEG; ответ - подносы, которые уехали из кадра
    POST /flush?camera=<id>                 закончить поток: отдать подносы, что ещё в кадре
"""

import base64
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np

from trayeye_camera.detector import Detector
from trayeye_camera.pipeline import TrayPipeline
from trayeye_camera.video import frames, jpeg, shrink

HOST = "127.0.0.1"
PORT = int(os.environ.get("VISION_PORT", "4110"))
INBOX = Path(os.environ.get("CAMERA_INBOX", Path(__file__).resolve().parents[1] / "uploads" / "camera-inbox")).resolve()
MAX_SECONDS = float(os.environ.get("CAMERA_MAX_SECONDS", "300"))   # дольше видео не разбираем
MAX_FRAME_BYTES = 3 * 1024 * 1024
LIVE_IDLE_SECONDS = 120   # живая камера молчит дольше - забываем её состояние

detector = Detector(threads=int(os.environ.get("VISION_THREADS", "1")))
live = {}  # camera id -> {"pipe": TrayPipeline, "start": time, "seen": time}


def tray_json(ev):
    return {
        "track_id": ev.track_id,
        "is_empty": ev.is_empty,
        "items": ev.items,
        "containers": ev.containers,
        "frames_seen": ev.frames_seen,
        "best_ts": round(ev.best_ts, 2),
        # Кадр подноса небольшой (10-30 КБ), передаём прямо в ответе.
        "crop_jpeg": base64.b64encode(jpeg(ev.crop)).decode("ascii"),
    }


def process_video(path, fps):
    pipe = TrayPipeline(detector, belt=True)
    trays, n, spent = [], 0, 0.0
    for ts, frame in frames(str(path), fps=fps):
        if ts > MAX_SECONDS:
            break
        t = time.perf_counter()
        trays += pipe.process(frame, ts)
        spent += time.perf_counter() - t
        n += 1
    trays += pipe.flush()
    return {
        "frames": n,
        "ms_per_frame": round(spent / max(1, n) * 1000, 1),
        "trays": [tray_json(ev) for ev in trays],
    }


def forget_idle_cameras():
    now = time.monotonic()
    for cam in [c for c, s in live.items() if now - s["seen"] > LIVE_IDLE_SECONDS]:
        del live[cam]


class Handler(BaseHTTPRequestHandler):
    server_version = "trayeye-vision"

    def log_message(self, fmt, *args):  # короткий лог в journald
        print(f"[vision] {self.command} {self.path.split('?')[0]} {fmt % args}", flush=True)

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self, limit):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > limit:
            return None
        return self.rfile.read(length)

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            return self.reply(200, {"status": "ok", "cameras": len(live)})
        self.reply(404, {"error": "not_found"})

    def do_POST(self):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/video":
                return self.video()
            if url.path == "/frame":
                return self.frame(query)
            if url.path == "/image":
                return self.image()
            if url.path == "/flush":
                state = live.pop(query.get("camera", ""), None)
                trays = state["pipe"].flush() if state else []
                return self.reply(200, {"trays": [tray_json(ev) for ev in trays]})
            self.reply(404, {"error": "not_found"})
        except Exception as err:  # noqa: BLE001 - сервис не должен падать от одного кривого файла
            print(f"[vision] ошибка: {err!r}", flush=True)
            self.reply(500, {"error": "vision_failed"})

    def video(self):
        raw = self.body(4096)
        req = json.loads(raw or b"{}")
        path = Path(str(req.get("path", ""))).resolve()
        # Только файлы из папки входящих: путь присылает Node, но проверяем всё равно.
        if INBOX not in path.parents or not path.is_file():
            return self.reply(400, {"error": "bad_path"})
        fps = min(5.0, max(1.0, float(req.get("fps", 3))))
        self.reply(200, process_video(path, fps))

    def image(self):
        """Одно фото подноса (повар снял на телефон): те же подносы и пустые тарелки, без трекинга."""
        raw = self.body(MAX_FRAME_BYTES * 4)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR) if raw else None
        if img is None:
            return self.reply(400, {"error": "bad_image"})
        pipe = TrayPipeline(detector, min_frames=1)
        trays = pipe.process(shrink(img, 960), 0.0) + pipe.flush()
        self.reply(200, {"trays": [tray_json(ev) for ev in trays]})

    def frame(self, query):
        cam = query.get("camera", "")
        if not cam or len(cam) > 64:
            return self.reply(400, {"error": "no_camera"})
        raw = self.body(MAX_FRAME_BYTES)
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR) if raw else None
        if img is None:
            return self.reply(400, {"error": "bad_image"})
        forget_idle_cameras()
        state = live.setdefault(cam, {"pipe": TrayPipeline(detector, belt=True), "start": time.monotonic()})
        state["seen"] = time.monotonic()
        ts = float(query["ts"]) if "ts" in query else time.monotonic() - state["start"]
        trays = state["pipe"].process(shrink(img, 960), ts)
        self.reply(200, {"trays": [tray_json(ev) for ev in trays]})


def main():
    # Папку создаёт Node при первой загрузке (на сервере у сервиса доступ только на чтение).
    if not INBOX.exists():
        print(f"[vision] папки {INBOX} пока нет, появится с первым видео", flush=True)
    print(f"[vision] слушаю http://{HOST}:{PORT}, папка видео {INBOX}", flush=True)
    HTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
