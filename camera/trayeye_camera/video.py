"""Чтение видео: файл, веб-камера (номер) или поток школьной камеры (rtsp://...).

Модели не нужны все 25-30 кадров в секунду: поднос едет по ленте несколько
секунд, поэтому берём 2-4 кадра в секунду. Это главный способ уложиться в слабый сервер.
"""

import time

import cv2
import numpy as np


def open_source(source):
    src = int(source) if str(source).isdigit() else str(source)
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise RuntimeError(f"Не удалось открыть видео: {source}")
    return cap


# 1920: кадр подноса для ИИ режем из полного кадра камеры - на уменьшенном до 960 модель
# хуже видела остатки. Детектор и модель фона ленты всё равно уменьшают кадр под себя.
def frames(source, fps=3.0, max_side=1920):
    """Отдаёт (ts, кадр) с частотой fps. ts - секунды от начала видео (для потока - от старта)."""
    cap = open_source(source)
    native = cap.get(cv2.CAP_PROP_FPS) or 0
    is_file = native > 0 and cap.get(cv2.CAP_PROP_FRAME_COUNT) > 0
    step = max(1, round(native / fps)) if is_file else 1
    start = time.monotonic()
    last_live = -1e9
    i = 0
    try:
        while True:
            ok = cap.grab()
            if not ok:
                break
            if is_file:
                if i % step:
                    i += 1
                    continue
                ts = i / native
            else:
                # Живой поток: кадры идут в реальном времени, лишние просто пропускаем.
                ts = time.monotonic() - start
                if ts - last_live < 1.0 / fps:
                    continue
                last_live = ts
            ok, frame = cap.retrieve()
            i += 1
            if not ok:
                continue
            yield ts, shrink(frame, max_side)
    finally:
        cap.release()


def shrink(frame, max_side):
    h, w = frame.shape[:2]
    if max(h, w) <= max_side:
        return frame
    k = max_side / max(h, w)
    return cv2.resize(frame, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)


def imread(path):
    # cv2.imread на Windows не открывает пути с кириллицей.
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)


def jpeg(img, quality=85):
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1].tobytes()
