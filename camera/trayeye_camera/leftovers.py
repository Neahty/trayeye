"""Локальная оценка остатков без токенов.

Нейросеть даёт контур тарелки. Обод тарелки почти всегда чистый: берём его цвет
как «пустую тарелку» и считаем, какая доля внутренней части заметно от него
отличается. Это не точный процент от порции (его уточняет ChatGPT), а фильтр:
пустые тарелки отсекаем здесь и за них не платим.
"""

import cv2
import numpy as np

# Порог отличия цвета от обода в пространстве Lab (ΔE). Ниже - тарелка, выше - еда.
FOOD_DELTA_E = 22.0
# Доля площади, ниже которой тарелку считаем пустой (крошки, блики, соус по краю).
EMPTY_SHARE = 0.06
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
    food = delta > FOOD_DELTA_E
    # Убираем одиночные блики/крошки: доля считается по сглаженной карте.
    food_map = np.zeros(mask.shape, np.uint8)
    food_map[inner] = food.astype(np.uint8) * 255
    food_map = cv2.morphologyEx(food_map, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    return float((food_map[inner] > 0).mean())


def estimate(image_bgr, containers):
    """containers: [{"kind": "plate"|"bowl"|"cup", "mask": bool HxW}] в координатах image_bgr.

    Возвращает (items, is_empty): по каждой тарелке доля еды и примерный остаток в %,
    is_empty = на всех тарелках пусто, ChatGPT можно не звать.
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
    is_empty = bool(items) and all(it["food_share"] < EMPTY_SHARE for it in items)
    return items, is_empty
