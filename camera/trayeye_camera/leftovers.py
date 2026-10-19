"""Локальная оценка остатков без токенов.

Нейросеть даёт контур тарелки. Обод тарелки почти всегда чистый: берём его цвет
как «пустую тарелку» и считаем, какая доля внутренней части заметно от него
отличается. Это не точный процент от порции (его уточняет ChatGPT), а фильтр:
пустые тарелки отсекаем здесь и за них не платим.
"""

import cv2
import numpy as np

# Порог отличия цвета от обода в пространстве Lab (ΔE). Ниже - тарелка, выше - еда.
# 16 и зернистость 6 подобраны на тестовой ленте (tools/eval_belt.py): 22 пропускал бежевый рис.
FOOD_DELTA_E = 16.0
# Доля площади, ниже которой тарелку считаем пустой (крошки, блики, соус по краю).
EMPTY_SHARE = 0.06
# Зернистость (СКО яркости в окне 7x7), выше которой это еда, а не гладкое дно тарелки.
TEXTURE_SD = 6.0
# Цветное пятно на подносе вне тарелок (компот, чай, пролитый суп): насыщенность и отличие
# от цвета подноса в плоскости a*b*, и доля площади подноса, с которой это уже «не пусто».
SPILL_CHROMA = 25.0
SPILL_DIFF = 18.0
SPILL_SHARE = 0.003
# Сколько площади тарелки обычно занимает полная порция: для перевода доли в проценты.
FULL_SHARE = {"plate": 0.55, "bowl": 0.85, "cup": 0.75}


def _rings(mask):
    """Внутренняя часть и обод маски по расстоянию до края.

    Самый край маски не берём: контур от модели неточный, туда попадает поднос
    и тень, и тогда чистая белая тарелка «отличается» от своего обода.
    """
    dist = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 3)
    depth = dist.max()
    if depth < 4:
        return None, None
    rim = (dist > depth * 0.08) & (dist <= depth * 0.25)
    inner = dist > depth * 0.3
    return inner, rim


def food_share(image_bgr, mask):
    """Доля внутренней части тарелки, занятая едой (0..1), или None, если тарелка слишком мала."""
    inner, rim = _rings(mask)
    if inner is None or rim.sum() < 20 or inner.sum() < 50:
        return None
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    # OpenCV хранит L в 0..255, приводим к шкале 0..100, как в ΔE.
    lab[..., 0] *= 100.0 / 255.0
    base = np.median(lab[rim], axis=0)
    delta = np.linalg.norm(lab[inner] - base, axis=1)
    # Белый рис и пюре на белой тарелке по цвету не отличить - зато они зернистые,
    # а дно тарелки гладкое (тень и блик меняются плавно).
    light = lab[..., 0]
    mean = cv2.blur(light, (7, 7))
    grain = np.sqrt(np.maximum(cv2.blur(light * light, (7, 7)) - mean * mean, 0))
    food = (delta > FOOD_DELTA_E) | (grain[inner] > TEXTURE_SD)
    # Убираем одиночные блики/крошки: доля считается по сглаженной карте.
    food_map = np.zeros(mask.shape, np.uint8)
    food_map[inner] = food.astype(np.uint8) * 255
    food_map = cv2.morphologyEx(food_map, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float((food_map[inner] > 0).mean())


def spill_share(image_bgr, containers, inset=0.12):
    """Доля подноса вне тарелок, где лежит что-то цветное: напиток в стакане (стаканы модель
    сверху находит плохо), пролитый суп. Приборы и салфетка бесцветные - их не считаем.
    Края кадра подноса не берём: там лента."""
    h, w = image_bgr.shape[:2]
    y1, y2, x1, x2 = int(h * inset), int(h * (1 - inset)), int(w * inset), int(w * (1 - inset))
    region = np.zeros((h, w), bool)
    region[y1:y2, x1:x2] = True
    for c in containers:
        grown = cv2.dilate(c["mask"].astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
        region &= ~grown
    if region.sum() < 200:
        return 0.0
    lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    ab = lab[..., 1:] - 128.0
    tray = np.median(ab[region], axis=0)
    chroma = np.linalg.norm(ab, axis=2)
    diff = np.linalg.norm(ab - tray, axis=2)
    spot = ((chroma > SPILL_CHROMA) & (diff > SPILL_DIFF) & region).astype(np.uint8) * 255
    spot = cv2.morphologyEx(spot, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float((spot > 0).sum() / region.sum())


def estimate(image_bgr, containers):
    """containers: [{"kind": "plate"|"bowl"|"cup", "mask": bool HxW}] в координатах image_bgr.

    Возвращает (items, is_empty): по каждой тарелке доля еды и примерный остаток в %,
    is_empty = на всех тарелках пусто и на подносе нет цветных пятен - ИИ можно не звать.
    Сколько тарелок должно быть на подносе, проверяет вызывающий (pipeline).
    """
    items = []
    for c in containers:
        share = food_share(image_bgr, c["mask"])
        if share is None:
            continue
        full = FULL_SHARE.get(c["kind"], 0.6)
        items.append({
            "kind": c["kind"],
            "food_share": round(share, 3),
            "leftover_pct": int(round(min(1.0, share / full) * 100)) if share >= EMPTY_SHARE else 0,
        })
    is_empty = (bool(items) and all(it["food_share"] < EMPTY_SHARE for it in items)
                and spill_share(image_bgr, containers) < SPILL_SHARE)
    return items, is_empty
