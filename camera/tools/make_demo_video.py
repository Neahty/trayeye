"""Тестовая «лента с подносами» для проверки прототипа камеры без настоящей съёмки.

Собирает видео: по ленте слева направо едут подносы с тарелками, на тарелках
разное количество еды (фото блюд из web/public/dishes). Рядом пишет JSON
с правильными ответами: какое блюдо и сколько осталось на каждом подносе.

    python tools/make_demo_video.py --out samples/belt.mp4 --trays 12
"""

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DISHES = ROOT / "web" / "public" / "dishes"

# Что кладём в глубокую тарелку, на плоскую и в стакан.
SOUPS = ["borscht", "shchi", "pea-soup", "chicken-noodle-soup"]
MAINS = ["plov", "buckwheat", "pasta", "rice", "mashed-potatoes", "cutlets", "meatballs", "fish-cutlets"]
DRINKS = ["kompot", "kissel", "tea"]
LEFTOVERS = [0, 0, 0, 10, 25, 50, 75, 100]  # чаще съедают всё

W, H, FPS = 1280, 720, 15
TRAY_W, TRAY_H = 420, 300
SPEED = 160  # пикселей в секунду
GAP = 260    # расстояние между подносами


def imread(path):
    # cv2.imread на Windows не открывает пути с кириллицей.
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)


def imwrite(path, img):
    cv2.imencode(Path(path).suffix, img)[1].tofile(str(path))


def food_texture(name, size):
    """Квадрат с едой: центр фото блюда, там почти всегда сама еда."""
    img = imread(DISHES / f"{name}.jpg")
    h, w = img.shape[:2]
    r = int(min(h, w) * 0.28)
    cy, cx = h // 2, w // 2
    crop = img[cy - r:cy + r, cx - r:cx + r]
    return cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)


def blob_mask(size, fraction, rng):
    """Неровное пятно еды площадью примерно fraction от круга тарелки."""
    mask = np.zeros((size, size), np.uint8)
    if fraction <= 0:
        # Пустая тарелка: пара крошек, их модель должна считать «съедено».
        for _ in range(rng.randint(1, 3)):
            cv2.circle(mask, (rng.randint(size // 3, 2 * size // 3), rng.randint(size // 3, 2 * size // 3)), 2, 255, -1)
        return mask
    radius = size / 2 * np.sqrt(fraction)
    cx = size / 2 + rng.uniform(-1, 1) * (size / 2 - radius) * 0.5
    cy = size / 2 + rng.uniform(-1, 1) * (size / 2 - radius) * 0.5
    pts = []
    for a in np.linspace(0, 2 * np.pi, 18, endpoint=False):
        rr = radius * rng.uniform(0.8, 1.15)
        pts.append((cx + rr * np.cos(a), cy + rr * np.sin(a)))
    cv2.fillPoly(mask, [np.array(pts, np.int32)], 255)
    return cv2.GaussianBlur(mask, (7, 7), 0)


def draw_dish(canvas, center, radius, food, fraction, rng, deep=False):
    x, y = center
    cv2.circle(canvas, (x + 4, y + 6), radius, (60, 60, 60), -1, cv2.LINE_AA)       # тень
    cv2.circle(canvas, (x, y), radius, (238, 240, 242), -1, cv2.LINE_AA)            # тарелка
    cv2.circle(canvas, (x, y), int(radius * 0.72), (225, 228, 230), 2, cv2.LINE_AA)  # бортик
    inner = int(radius * (0.7 if deep else 0.78))
    size = inner * 2
    tex = food_texture(food, size)
    mask = blob_mask(size, fraction, rng).astype(np.float32) / 255
    circle = np.zeros((size, size), np.float32)
    cv2.circle(circle, (inner, inner), inner, 1.0, -1, cv2.LINE_AA)
    alpha = (mask * circle)[..., None]
    roi = canvas[y - inner:y + inner, x - inner:x + inner].astype(np.float32)
    canvas[y - inner:y + inner, x - inner:x + inner] = (roi * (1 - alpha) + tex * alpha).astype(np.uint8)


def make_tray(rng):
    """Поднос как картинка + правильные ответы."""
    color = rng.choice([(90, 140, 190), (150, 150, 150), (70, 110, 60), (60, 90, 170)])
    tray = np.full((TRAY_H, TRAY_W, 3), color, np.uint8)
    cv2.rectangle(tray, (6, 6), (TRAY_W - 7, TRAY_H - 7), tuple(int(c * 0.8) for c in color), 4, cv2.LINE_AA)
    noise = rng.randint(0, 9999)
    tray = cv2.add(tray, np.random.default_rng(noise).integers(0, 12, tray.shape, dtype=np.uint8))

    soup, main, drink = rng.choice(SOUPS), rng.choice(MAINS), rng.choice(DRINKS)
    items = [
        {"dish": soup, "leftover_pct": rng.choice(LEFTOVERS)},
        {"dish": main, "leftover_pct": rng.choice(LEFTOVERS)},
        {"dish": drink, "leftover_pct": rng.choice([0, 0, 50, 100])},
    ]
    draw_dish(tray, (105, 145), 88, soup, items[0]["leftover_pct"] / 100, rng, deep=True)
    draw_dish(tray, (300, 118), 90, main, items[1]["leftover_pct"] / 100 * 0.8, rng)
    # Стакан сверху: круг с напитком, пустой - только светлое дно.
    cx, cy, r = 300, 255, 34
    cv2.circle(tray, (cx + 3, cy + 4), r, (60, 60, 60), -1, cv2.LINE_AA)
    cv2.circle(tray, (cx, cy), r, (215, 225, 230), -1, cv2.LINE_AA)
    if items[2]["leftover_pct"]:
        level = int((r - 6) * np.sqrt(items[2]["leftover_pct"] / 100))
        drink_color = food_texture(drink, 8)[4, 4].tolist()
        cv2.circle(tray, (cx, cy), level, drink_color, -1, cv2.LINE_AA)
    return tray, items


def belt_frame(t):
    frame = np.full((H, W, 3), (48, 50, 52), np.uint8)
    offset = int(t * SPEED) % 40
    for x in range(-40 + offset, W, 40):  # рёбра ленты едут вместе с подносами
        cv2.line(frame, (x, 120), (x, H - 120), (40, 42, 44), 3)
    cv2.rectangle(frame, (0, 100), (W, 120), (30, 30, 30), -1)
    cv2.rectangle(frame, (0, H - 120), (W, H - 100), (30, 30, 30), -1)
    return frame


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="samples/belt.mp4")
    ap.add_argument("--trays", type=int, default=12)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    trays = [make_tray(rng) for _ in range(args.trays)]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    step = TRAY_W + GAP
    duration = (W + step * args.trays) / SPEED
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    y0 = (H - TRAY_H) // 2
    for i in range(int(duration * FPS)):
        t = i / FPS
        frame = belt_frame(t)
        for n, (img, _) in enumerate(trays):
            x = int(t * SPEED) - TRAY_W - n * step
            if x + TRAY_W <= 0 or x >= W:
                continue
            a, b = max(x, 0), min(x + TRAY_W, W)
            frame[y0:y0 + TRAY_H, a:b] = img[:, a - x:b - x]
        writer.write(frame)
    writer.release()

    # center_ts - секунда, когда поднос в центре кадра: по ней сверяем с найденными.
    truth = [{"tray": n + 1, "center_ts": round((W / 2 + TRAY_W / 2 + n * step) / SPEED, 2), "items": items}
             for n, (_, items) in enumerate(trays)]
    out.with_suffix(".json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    for n, (img, _) in enumerate(trays[:3]):
        imwrite(out.parent / f"tray-{n + 1}.jpg", img)
    print(f"{out}: {args.trays} подносов, {duration:.0f} с")


if __name__ == "__main__":
    main()
