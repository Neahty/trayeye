"""Тестовая «лента с подносами» для проверки камеры и ИИ без настоящей съёмки.

Собирает видео: по ленте слева направо едут подносы - суп в миске, второе на тарелке,
напиток в стакане, приборы и салфетка. Еда - фото блюд из web/public/dishes, остаток
рисуется неровной кучкой с крошками и разводами. Рядом пишет JSON с правильными
ответами: какое блюдо и сколько процентов порции осталось на каждом подносе.

    python tools/make_demo_video.py --out samples/belt.mp4 --trays 12
    python tools/make_demo_video.py --out samples/eval-a.mp4 --minutes 5 --seed 11

Видео пишет ffmpeg в H.264 (60 кадров/с), так его можно сразу показывать в браузере.
"""

import argparse
import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DISHES = ROOT / "web" / "public" / "dishes"

SOUPS = ["borscht", "shchi", "pea-soup", "chicken-noodle-soup"]
MAINS = ["plov", "buckwheat", "pasta", "rice", "mashed-potatoes", "cutlets", "meatballs", "fish-cutlets"]
DRINKS = ["kompot", "kissel", "tea"]
DRINK_BGR = {"kompot": (40, 60, 150), "kissel": (60, 40, 170), "tea": (30, 95, 160)}
# Чаще всего съедают всё, но остатки встречаются любые, а не только «половина».
LEFTOVERS = [0, 0, 0, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
DRINK_LEFT = [0, 0, 0, 25, 50, 75, 100]
# Полная порция закрывает такую долю дна тарелки; остаток = доля от неё.
FULL_COVER = 0.78

W, H = 1280, 720
TRAY_W, TRAY_H = 440, 310
SPEED = 150  # пикселей в секунду
DAY_TRAYS = 10


def imread(path):
    # cv2.imread на Windows не открывает пути с кириллицей.
    return cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)


def imwrite(path, img):
    cv2.imencode(Path(path).suffix, img)[1].tofile(str(path))


_TEX = {}
# Где на фото блюда только еда, без посуды и стола: центр (доли ширины и высоты) и радиус
# (доля меньшей стороны). Подобрано по фото из web/public/dishes.
FOOD_SPOT = {
    "borscht": (0.47, 0.43, 0.13), "shchi": (0.5, 0.5, 0.22), "pea-soup": (0.5, 0.5, 0.28),
    "chicken-noodle-soup": (0.5, 0.48, 0.22), "plov": (0.5, 0.5, 0.3), "buckwheat": (0.48, 0.52, 0.22),
    "pasta": (0.5, 0.5, 0.35), "rice": (0.52, 0.27, 0.08), "mashed-potatoes": (0.51, 0.32, 0.12),
    "cutlets": (0.54, 0.37, 0.15), "meatballs": (0.5, 0.52, 0.25), "fish-cutlets": (0.56, 0.48, 0.2),
}


def food_texture(name, size, rng):
    """Квадрат с едой с фото блюда, со случайным поворотом - кучки не одинаковые."""
    if name not in _TEX:
        _TEX[name] = imread(DISHES / f"{name}.jpg")
    img = _TEX[name]
    h, w = img.shape[:2]
    fx, fy, fr = FOOD_SPOT[name]
    r = int(min(h, w) * fr)
    cy = int(fy * h) + rng.randint(-r // 8, r // 8)
    cx = int(fx * w) + rng.randint(-r // 8, r // 8)
    crop = img[max(0, cy - r):cy + r, max(0, cx - r):cx + r]
    crop = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
    rot = cv2.getRotationMatrix2D((size / 2, size / 2), rng.uniform(0, 360), 1.15)
    return cv2.warpAffine(crop, rot, (size, size), borderMode=cv2.BORDER_REFLECT).astype(np.float32)


def lumpy_mask(size, area, rng, center_jitter=0.35):
    """Неровная кучка еды площадью area (доля круга диаметра size): несколько эллипсов вместе."""
    if area <= 0:
        return np.zeros((size, size), np.float32)
    target = area * math.pi * (size / 2) ** 2
    circle = np.zeros((size, size), np.uint8)
    cv2.circle(circle, (size // 2, size // 2), size // 2 - 1, 1, -1)
    lumps = [(rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.6, 1.0), rng.uniform(0.6, 1.0), rng.uniform(0, 180))
             for _ in range(rng.randint(3, 6))]
    lo, hi = 0.02, 1.6
    for _ in range(18):  # подбираем масштаб, пока площадь не совпадёт с нужной
        k = (lo + hi) / 2
        m = np.zeros((size, size), np.uint8)
        base = size / 2 * k
        for dx, dy, ax, ay, ang in lumps:
            c = (int(size / 2 + dx * base * center_jitter), int(size / 2 + dy * base * center_jitter))
            cv2.ellipse(m, c, (max(1, int(base * ax)), max(1, int(base * ay))), ang, 0, 360, 1, -1)
        m &= circle
        if m.sum() < target:
            lo = k
        else:
            hi = k
    return cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.6)


def residue(size, rng, strength):
    """Разводы и крошки на съеденной части: модель не должна принимать их за порцию."""
    m = np.zeros((size, size), np.float32)
    for _ in range(rng.randint(4, 12)):
        cv2.circle(m, (rng.randint(size // 5, 4 * size // 5), rng.randint(size // 5, 4 * size // 5)),
                   rng.randint(1, 3), 1.0, -1, cv2.LINE_AA)
    for _ in range(rng.randint(1, 3)):
        p1 = (rng.randint(size // 4, 3 * size // 4), rng.randint(size // 4, 3 * size // 4))
        p2 = (p1[0] + rng.randint(-size // 3, size // 3), p1[1] + rng.randint(-size // 3, size // 3))
        cv2.line(m, p1, p2, 0.35, rng.randint(4, 10), cv2.LINE_AA)
    return cv2.GaussianBlur(m, (0, 0), 1.2) * strength


def blend(canvas, x, y, img, alpha):
    """Накладывает img (float BGR) с прозрачностью alpha (0..1) в точку (x, y) левого верхнего угла."""
    h, w = alpha.shape
    roi = canvas[y:y + h, x:x + w]
    a = alpha[..., None]
    roi[:] = roi * (1 - a) + img * a


def shaded_disc(size, base, rim_light=18, well=0.74, well_dark=14):
    """Тарелка сверху: светлый обод, чуть затенённое дно, блик сверху слева."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    r = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    img = np.empty((size, size, 3), np.float32)
    img[:] = base
    rim = (r > well) & (r <= 1)
    img[rim] += rim_light * (1 - (r[rim] - well) / (1 - well))[:, None]
    img[r <= well] -= well_dark * (r[r <= well] / well)[:, None] ** 2
    img[np.abs(r - well) < 0.025] -= 18
    light = np.clip(1 - np.hypot(xx - size * 0.32, yy - size * 0.28) / (size * 0.55), 0, 1)
    img += 22 * light[..., None] ** 2
    alpha = np.clip((1 - r) * size / 2, 0, 1)
    return np.clip(img, 0, 255), alpha


def draw_dish(tray, center, radius, food, pct, rng, deep=False):
    """Тарелка (deep - миска с супом) и остаток еды pct% от полной порции."""
    size = radius * 2
    x0, y0 = center[0] - radius, center[1] - radius
    sh = np.zeros(tray.shape[:2], np.float32)
    cv2.circle(sh, (center[0] + 5, center[1] + 7), radius, 0.45, -1, cv2.LINE_AA)
    tray *= (1 - cv2.GaussianBlur(sh, (0, 0), 6))[..., None]
    plate, a = shaded_disc(size, (236, 238, 240) if not deep else (232, 236, 238), well=0.62 if deep else 0.74,
                           well_dark=26 if deep else 12)
    blend(tray, x0, y0, plate, a)

    inner = int(radius * (0.6 if deep else 0.72))
    isz = inner * 2
    ix, iy = center[0] - inner, center[1] - inner
    tex = food_texture(food, isz, rng)
    if deep:
        # Суп сверху: жидкость заполняет дно миски, уровень ниже - пятно меньше.
        level = pct / 100
        m = np.zeros((isz, isz), np.float32)
        if level > 0:
            rr = inner * max(0.3, math.sqrt(level))  # площадь супа ~ уровню
            cv2.circle(m, (inner + rng.randint(-3, 3), inner + rng.randint(-3, 3)), int(rr), 1.0, -1, cv2.LINE_AA)
            m = cv2.GaussianBlur(m, (0, 0), 1.5)
        tex = tex * 0.85 + 20
    else:
        m = lumpy_mask(isz, FULL_COVER * pct / 100, rng)
        # Объём кучки: к краю темнее.
        dist = cv2.distanceTransform((m > 0.5).astype(np.uint8), cv2.DIST_L2, 3)
        if dist.max() > 0:
            tex = tex * (0.78 + 0.22 * np.clip(dist / 12, 0, 1))[..., None]
    smear = residue(isz, rng, 0.5 if pct < 100 else 0.0)
    blend(tray, ix, iy, cv2.GaussianBlur(tex, (0, 0), 6), smear * (1 - m))
    blend(tray, ix, iy, tex, m)


def draw_glass(tray, center, r, drink, pct, rng):
    cx, cy = center
    sh = np.zeros(tray.shape[:2], np.float32)
    cv2.circle(sh, (cx + 4, cy + 6), r, 0.35, -1, cv2.LINE_AA)
    tray *= (1 - cv2.GaussianBlur(sh, (0, 0), 5))[..., None]
    glass, a = shaded_disc(r * 2, (222, 228, 232), rim_light=25, well=0.82, well_dark=20)
    blend(tray, cx - r, cy - r, glass, a * 0.95)
    if pct:
        lr = int((r * 0.8) * (0.45 + 0.55 * math.sqrt(pct / 100)))
        col = np.array(DRINK_BGR[drink], np.float32) + rng.uniform(-10, 10)
        liquid, la = shaded_disc(lr * 2, col, rim_light=30, well=0.85, well_dark=10)
        blend(tray, cx - lr, cy - lr, liquid, la * 0.92)
    cv2.ellipse(tray, (cx - r // 3, cy - r // 3), (r // 4, r // 8), -40, 0, 360, (250, 250, 250), -1, cv2.LINE_AA)


def draw_cutlery(tray, rng):
    """Ложка и вилка - лишние для модели предметы, как на настоящем подносе."""
    x, y = rng.randint(200, 230), rng.randint(40, 60)
    ang = rng.uniform(-8, 8)
    for k in range(rng.randint(1, 2)):
        p1 = (x + k * 18, y)
        p2 = (int(p1[0] + 150 * math.sin(math.radians(ang))), int(p1[1] + 150 * math.cos(math.radians(ang))))
        sh = np.zeros(tray.shape[:2], np.float32)
        cv2.line(sh, (p1[0] + 4, p1[1] + 5), (p2[0] + 4, p2[1] + 5), 0.35, 7, cv2.LINE_AA)
        tray *= (1 - cv2.GaussianBlur(sh, (0, 0), 2.5))[..., None]
        cv2.line(tray, p1, p2, (198, 200, 204), 6, cv2.LINE_AA)
        cv2.ellipse(tray, p1, (10, 16), -ang, 0, 360, (205, 207, 210), -1, cv2.LINE_AA)


def draw_napkin(tray, rng):
    x, y = rng.randint(330, 380), rng.randint(230, 255)
    pts = np.array([(x + rng.randint(-5, 5) + dx, y + rng.randint(-5, 5) + dy)
                    for dx, dy in [(0, 0), (48, -6), (55, 34), (6, 40), (-6, 18)]], np.int32)
    cv2.fillPoly(tray, [pts + 3], (150, 150, 150), cv2.LINE_AA)
    cv2.fillPoly(tray, [pts], (246, 246, 244), cv2.LINE_AA)
    cv2.polylines(tray, [pts], True, (225, 225, 222), 1, cv2.LINE_AA)


TRAY_COLORS = [(170, 190, 205), (88, 98, 112), (140, 150, 150), (60, 120, 70), (150, 110, 70), (205, 210, 212)]


def day_menu(rng):
    """Меню одного обеда, как в школе: один суп, два вторых на выбор, один-два напитка."""
    return {"soups": [rng.choice(SOUPS)], "mains": rng.sample(MAINS, 2), "drinks": rng.sample(DRINKS, rng.randint(1, 2))}


def make_tray(rng, menu):
    """Поднос: картинка (float BGR), прозрачность и правильные ответы."""
    tray = np.empty((TRAY_H, TRAY_W, 3), np.float32)
    tray[:] = rng.choice(TRAY_COLORS)
    yy = np.mgrid[0:TRAY_H, 0:TRAY_W][0].astype(np.float32)
    tray += (12 * (1 - yy / TRAY_H) - 6)[..., None]                         # свет сверху
    tray += np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, 2.5, tray.shape).astype(np.float32)
    shape = np.zeros((TRAY_H, TRAY_W), np.uint8)
    cv2.rectangle(shape, (24, 24), (TRAY_W - 25, TRAY_H - 25), 255, -1)  # поле 6 пикселей под тень
    shape = cv2.dilate(shape, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (37, 37)))
    # Бортик: светлая полоса по краю и тёмная линия внутри - только в пределах подноса.
    rim = (shape > 0) & (cv2.erode(shape, np.ones((13, 13), np.uint8)) == 0)
    tray[rim] += 20
    inner = cv2.erode(shape, np.ones((17, 17), np.uint8))
    tray[(inner > 0) & (cv2.erode(inner, np.ones((3, 3), np.uint8)) == 0)] -= 16

    soup, main, drink = rng.choice(menu["soups"]), rng.choice(menu["mains"]), rng.choice(menu["drinks"])
    items = [
        {"dish": soup, "leftover_pct": rng.choice(LEFTOVERS)},
        {"dish": main, "leftover_pct": rng.choice(LEFTOVERS)},
        {"dish": drink, "leftover_pct": rng.choice(DRINK_LEFT)},
    ]
    draw_cutlery(tray, rng)
    draw_dish(tray, (112 + rng.randint(-6, 6), 152 + rng.randint(-8, 8)), 84, soup, items[0]["leftover_pct"], rng, deep=True)
    draw_dish(tray, (318 + rng.randint(-6, 6), 128 + rng.randint(-6, 6)), 92, main, items[1]["leftover_pct"], rng)
    draw_glass(tray, (250 + rng.randint(-6, 6), 255), 30, drink, items[2]["leftover_pct"], rng)
    if rng.random() < 0.6:
        draw_napkin(tray, rng)
    alpha = cv2.GaussianBlur(shape.astype(np.float32) / 255, (0, 0), 0.8)
    return np.clip(tray, 0, 255), alpha, items


def make_belt(width):
    """Резиновая лента с поперечными рёбрами и металлические борта, текстура длиннее кадра."""
    rng = np.random.default_rng(3)
    belt = np.empty((H, width, 3), np.float32)
    belt[:] = (46, 47, 49)
    belt += rng.normal(0, 3, belt.shape).astype(np.float32)
    belt = cv2.GaussianBlur(belt, (0, 0), 0.7)
    for x in range(0, width, 36):
        belt[:, x:x + 3] -= 9
        belt[:, x + 3:x + 4] += 5
    rail = np.linspace(150, 95, 70, dtype=np.float32)[:, None, None]
    belt[0:70] = rail + rng.normal(0, 2, (70, width, 3))
    belt[H - 70:H] = rail[::-1] + rng.normal(0, 2, (70, width, 3))
    belt[70:80] *= 0.55
    belt[H - 80:H - 70] *= 0.55
    return belt


def vignette():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
    return (1 - 0.22 * np.clip(r - 0.35, 0, 1) ** 1.5)[..., None]


def place(frame, img, alpha, shadow, x, y):
    """Поднос с тенью на ленту, с обрезкой по краям кадра."""
    h, w = alpha.shape
    a0, a1 = max(0, x), min(W, x + w)
    if a1 <= a0:
        return
    sl = slice(a0 - x, a1 - x)
    sy = y + 10
    frame[sy:sy + h, a0:a1] *= (1 - shadow[:, sl])[..., None]
    a = alpha[:, sl][..., None]
    frame[y:y + h, a0:a1] = frame[y:y + h, a0:a1] * (1 - a) + img[:, sl] * a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="samples/belt.mp4")
    ap.add_argument("--trays", type=int, default=12)
    ap.add_argument("--minutes", type=float, default=0, help="длина видео; тогда --trays считается само")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--fps", type=int, default=60)
    args = ap.parse_args()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("Нужен ffmpeg")
    rng = random.Random(args.seed)
    n = int((args.minutes * 60 * SPEED - W) / (TRAY_W + 345)) if args.minutes else args.trays

    trays, pos = [], 0
    for k in range(n):
        # Лента делится на «обеды» по DAY_TRAYS подносов, у каждого своё меню: его же получает ИИ.
        if k % DAY_TRAYS == 0:
            menu = day_menu(rng)
        img, alpha, items = make_tray(rng, menu)
        pad = 30
        big = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_CONSTANT)
        bal = cv2.copyMakeBorder(alpha, pad, pad, pad, pad, cv2.BORDER_CONSTANT)
        rot = cv2.getRotationMatrix2D((big.shape[1] / 2, big.shape[0] / 2), rng.uniform(-4, 4), 1.0)
        big = cv2.warpAffine(big, rot, big.shape[1::-1], flags=cv2.INTER_LINEAR)
        bal = cv2.warpAffine(bal, rot, bal.shape[1::-1], flags=cv2.INTER_LINEAR)
        # Лёгкий смаз по ходу ленты: камера снимает движущийся поднос.
        big = cv2.blur(big, (max(1, SPEED // args.fps) + 1, 1))
        y = (H - big.shape[0]) // 2 + rng.randint(-18, 18)
        trays.append({"img": big, "alpha": bal, "shadow": cv2.GaussianBlur(bal, (0, 0), 9) * 0.5,
                      "items": items, "menu": [d for part in menu.values() for d in part], "y": y, "off": pos})
        # Расстояние между подносами разное: дети ставят их как придётся.
        pos += big.shape[1] + rng.randint(150, 420)

    duration = (W + pos) / SPEED
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
                             "-s", f"{W}x{H}", "-r", str(args.fps), "-i", "-", "-an", "-c:v", "libx264",
                             "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                             str(out)], stdin=subprocess.PIPE)
    belt = make_belt(W + 36)
    vig = vignette()
    noise = np.random.default_rng(5)
    for i in range(int(duration * args.fps)):
        t = i / args.fps
        shift = int(t * SPEED) % 36
        frame = belt[:, 36 - shift:36 - shift + W].copy()
        for tr in trays:
            x = int(round(t * SPEED)) - tr["img"].shape[1] - tr["off"]
            if -tr["img"].shape[1] < x < W:
                place(frame, tr["img"], tr["alpha"], tr["shadow"], x, tr["y"])
        frame *= vig
        frame += noise.normal(0, 2.0, (H, W, 1)).astype(np.float32)
        proc.stdin.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())
    proc.stdin.close()
    proc.wait()

    # center_ts - секунда, когда поднос в центре кадра: по ней сверяем с найденными.
    truth = [{"tray": k + 1, "center_ts": round((W / 2 + tr["img"].shape[1] / 2 + tr["off"]) / SPEED, 2),
              "items": tr["items"], "menu": tr["menu"]} for k, tr in enumerate(trays)]
    out.with_suffix(".json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    for k, tr in enumerate(trays[:3]):
        imwrite(out.parent / f"tray-{k + 1}.jpg", np.clip(tr["img"], 0, 255).astype(np.uint8))
    print(f"{out}: {n} подносов, {duration:.0f} с, {args.fps} кадров/с")


if __name__ == "__main__":
    main()
