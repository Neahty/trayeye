"""Кадры с ленты -> события «поднос проехал».

На каждом кадре: модель находит подносы и тарелки, тарелки собираются в подносы,
подносы связываются с прошлыми кадрами (трекинг). Пока поднос едет, запоминаем
кадр, где он ближе всего к центру и целиком в кадре. Когда поднос уехал, отдаём
одно событие: вырезанный поднос + локальная оценка остатков. Дальше вызывающий
решает, звать ли ChatGPT (только если на подносе что-то осталось).
"""

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import leftovers
from .belt import BeltSegmenter
from .classes import CONTAINERS


@dataclass
class TrayEvent:
    track_id: int
    crop: np.ndarray                 # BGR, поднос с небольшим полем
    containers: list                 # [{"kind", "conf", "box"}] в координатах crop
    items: list                      # локальная оценка по каждой тарелке
    is_empty: bool                   # всё съедено - ChatGPT не нужен
    frames_seen: int
    first_ts: float
    last_ts: float
    best_ts: float                   # когда снят кадр подноса (он тогда ближе всего к центру)


@dataclass
class _Track:
    id: int
    box: tuple
    first_ts: float
    last_ts: float
    last_frame: int
    frames_seen: int = 1
    best_score: float = -1e9
    best: dict = field(default_factory=dict)
    def predicted(self, ts, velocity):
        dt = ts - self.last_ts
        x1, y1, x2, y2 = self.box
        vx, vy = velocity
        return x1 + vx * dt, y1 + vy * dt, x2 + vx * dt, y2 + vy * dt


def _union(boxes):
    xs1, ys1, xs2, ys2 = zip(*boxes)
    return min(xs1), min(ys1), max(xs2), max(ys2)


def _expand(box, k):
    x1, y1, x2, y2 = box
    dx, dy = (x2 - x1) * k, (y2 - y1) * k
    return x1 - dx, y1 - dy, x2 + dx, y2 + dy


def _overlap(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def _inside(point, box):
    x, y = point
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def group_trays(dets):
    """Подносы на кадре: [(box, [тарелки])]. Если модель не нашла сам поднос,
    собираем его из стоящих рядом тарелок."""
    containers = [d for d in dets if d.kind in CONTAINERS and d.mask is not None]
    # Модель иногда называет «тарелкой» весь поднос: если внутри неё центры
    # двух других тарелок, это поднос.
    tray_like = [c for c in containers
                 if sum(o is not c and _inside(o.center(), c.box) for o in containers) >= 2]
    containers = [c for c in containers if c not in tray_like]
    trays = sorted([d for d in dets if d.kind == "tray"] + tray_like, key=lambda d: -d.conf)
    groups, used = [], set()
    for t in trays:
        inside = [c for c in containers if id(c) not in used and _inside(c.center(), t.box)]
        if not inside:
            continue  # пустой «поднос» - скорее всего кусок ленты
        used.update(id(c) for c in inside)
        groups.append((_union([t.box] + [c.box for c in inside]), inside))

    rest = [c for c in containers if id(c) not in used]
    # Объединяем соседние тарелки: рамки, расширенные на 35%, пересекаются.
    clusters = []
    for c in rest:
        grown = _expand(c.box, 0.35)
        hit = [cl for cl in clusters if any(_overlap(grown, _expand(o.box, 0.35)) for o in cl)]
        merged = [c] + [o for cl in hit for o in cl]
        clusters = [cl for cl in clusters if cl not in hit] + [merged]
    for cl in clusters:
        box = _union([c.box for c in cl])
        # Тарелка вылезла за рамку подноса от модели - это тот же поднос, а не новый.
        owner = next((g for g in groups if _overlap(box, _expand(g[0], 0.1))), None)
        if owner:
            groups[groups.index(owner)] = (_union([owner[0], box]), owner[1] + cl)
        else:
            groups.append((box, cl))

    # Подносы на ленте друг на друга не налезают: пересекающиеся группы - один поднос,
    # иначе он распадается на два трека и уходит в ChatGPT дважды.
    merged = True
    while merged:
        merged = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if _overlap(_expand(groups[i][0], 0.03), _expand(groups[j][0], 0.03)):
                    groups[i] = (_union([groups[i][0], groups[j][0]]), groups[i][1] + groups[j][1])
                    del groups[j]
                    merged = True
                    break
            if merged:
                break
    return groups


def _area(b):
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _iou(a, b):
    inter = _area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))
    return inter / max(1.0, _area(a) + _area(b) - inter)


def _dedupe(containers):
    """Одна тарелка, найденная дважды (как plate и как bowl), - оставляем уверенную находку."""
    kept = []
    for c in sorted(containers, key=lambda d: -d.conf):
        if all(_iou(c.box, k.box) < 0.6 for k in kept):
            kept.append(c)
    return kept


def assign_trays(dets, boxes):
    """Подносы от модели фона ленты + тарелки от YOLOE, чей центр внутри подноса."""
    containers = [d for d in dets if d.kind in CONTAINERS and d.mask is not None]
    groups = []
    for box in boxes:
        tray_area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
        # Сначала убираем повторы одной тарелки, иначе её копии ниже сочтут подносом.
        members = _dedupe([c for c in containers if _inside(c.center(), box)])
        # Модель иногда называет «тарелкой» весь поднос: её маска накрывает суп и второе,
        # и пустой поднос выглядит полным. Такую «тарелку» выкидываем.
        members = [c for c in members
                   if _area(c.box) < 0.45 * tray_area
                   and sum(o is not c and _inside(o.center(), c.box) for o in members) < 2]
        # Тарелка у края может выступать за пятно подноса: рамка должна вмещать её целиком.
        groups.append((_union([box] + [c.box for c in members]), members))
    return groups


def _hull_mask(mask):
    """Маски у модели бывают пятнистыми, а тарелки выпуклые: берём выпуклую оболочку."""
    m = mask.astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return mask
    hull = cv2.convexHull(np.concatenate(contours))
    out = np.zeros_like(m)
    cv2.fillPoly(out, [hull], 1)
    return out.astype(bool)


class TrayPipeline:
    def __init__(self, detector, max_missed=4, min_frames=2, margin=0.06, belt=False):
        self.detector = detector
        # belt=True - видео с неподвижной камеры над лентой: подносы ищем по фону ленты (belt.py).
        self.belt = BeltSegmenter() if belt else None
        self.passes = []  # сколько кадров длились проезды подносов - отличать обрывки
        self.counts = []  # сколько посуды находили на подносах - сколько её обычно
        self.max_missed = max_missed    # сколько обработанных кадров поднос может «пропасть»
        self.min_frames = min_frames    # меньше - случайная вспышка, не поднос
        self.margin = margin
        self.tracks = {}
        self.next_id = 1
        self.frame_idx = 0
        self.last_dets = []
        self.last_groups = []
        # Скорость ленты (пикс/с) - одна на все подносы. Если модель на секунду потеряла
        # поднос, ждём его дальше по ходу ленты, а не там, где видели в последний раз.
        self.velocity = (0.0, 0.0)

    def _learn_velocity(self, old_box, new_box, dt):
        ow, nw = old_box[2] - old_box[0], new_box[2] - new_box[0]
        oh, nh = old_box[3] - old_box[1], new_box[3] - new_box[1]
        # Рамка, меняющая размер (въезд, выезд, потерянная тарелка), врёт о движении.
        if dt <= 0 or not (0.9 < nw / max(1, ow) < 1.1 and 0.9 < nh / max(1, oh) < 1.1):
            return
        vx = ((new_box[0] + new_box[2]) - (old_box[0] + old_box[2])) / 2 / dt
        vy = ((new_box[1] + new_box[3]) - (old_box[1] + old_box[3])) / 2 / dt
        px, py = self.velocity
        self.velocity = (0.7 * px + 0.3 * vx, 0.7 * py + 0.3 * vy)

    def process(self, frame, ts):
        """Обрабатывает кадр, возвращает подносы, которые только что уехали из кадра."""
        self.frame_idx += 1
        dets = self.detector.detect(frame)
        boxes = self.belt.boxes(frame) if self.belt else None
        groups = assign_trays(dets, boxes) if boxes is not None else group_trays(dets)
        self.last_dets = dets
        h, w = frame.shape[:2]

        free = set(self.tracks)
        assigned = []
        for box, members in sorted(groups, key=lambda g: -(g[0][2] - g[0][0]) * (g[0][3] - g[0][1])):
            track = self._match(box, free, ts)
            if track is None:
                track = _Track(self.next_id, box, ts, ts, self.frame_idx)
                self.tracks[track.id] = track
                self.next_id += 1
            else:
                free.discard(track.id)
                self._learn_velocity(track.box, box, ts - track.last_ts)
                track.box, track.last_ts, track.last_frame = box, ts, self.frame_idx
                track.frames_seen += 1
            assigned.append((track.id, box))
            self._maybe_snapshot(track, frame, box, members, w, h)

        self.last_groups = assigned
        return self._finish(lambda t: self.frame_idx - t.last_frame > self.max_missed)

    def flush(self):
        """Конец видео: отдать все подносы, которые ещё в кадре."""
        return self._finish(lambda t: True)

    def _match(self, box, free, ts):
        """Тот же поднос на прошлых кадрах: рамки перекрываются или центры рядом.

        Сравниваем с местом, куда поднос должен был доехать по скорости ленты: если
        модель на секунду его потеряла, он успевает уехать дальше своей ширины.
        Подносы на ленте друг друга не перекрывают, поэтому перекрытие надёжно,
        особенно когда поднос въезжает в кадр и его рамка быстро растёт от края.
        """
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        area = (box[2] - box[0]) * (box[3] - box[1])
        best, best_score = None, 0.0
        for tid in free:
            t = self.tracks[tid]
            tb = t.predicted(ts, self.velocity)
            ix = max(0, min(box[2], tb[2]) - max(box[0], tb[0]))
            iy = max(0, min(box[3], tb[3]) - max(box[1], tb[1]))
            t_area = (tb[2] - tb[0]) * (tb[3] - tb[1])
            overlap = ix * iy / max(1, min(area, t_area))
            tx, ty = (tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2
            size = max(tb[2] - tb[0], tb[3] - tb[1], box[2] - box[0], box[3] - box[1])
            near = 1 - np.hypot(cx - tx, cy - ty) / size / 0.6
            score = max(overlap if overlap >= 0.3 else 0.0, near)
            if score > best_score:
                best, best_score = t, score
        return best

    def _maybe_snapshot(self, track, frame, box, members, w, h):
        x1, y1, x2, y2 = box
        fully_inside = x1 > 3 and y1 > 3 and x2 < w - 3 and y2 < h - 3
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        # Лучший кадр: поднос целиком в кадре, на нём найдено больше тарелок (иначе ChatGPT
        # увидит пол-подноса) и он ближе к центру (там меньше искажения объектива).
        score = ((1.0 if fully_inside else 0.0) + 0.3 * min(len(members), 4)
                 - abs(cx - w / 2) / w - abs(cy - h / 2) / h)
        if score <= track.best_score:
            return
        mx, my = (x2 - x1) * self.margin, (y2 - y1) * self.margin
        cx1, cy1 = int(max(0, x1 - mx)), int(max(0, y1 - my))
        cx2, cy2 = int(min(w, x2 + mx)), int(min(h, y2 + my))
        crop = frame[cy1:cy2, cx1:cx2].copy()
        containers = []
        for c in members:
            bx1, by1, bx2, by2 = c.box
            full = np.zeros(crop.shape[:2], bool)
            mh, mw = c.mask.shape
            ox, oy = bx1 - cx1, by1 - cy1
            full[oy:oy + mh, ox:ox + mw] = _hull_mask(c.mask)[:crop.shape[0] - oy, :crop.shape[1] - ox]
            containers.append({"kind": c.kind, "conf": round(c.conf, 2),
                               "box": (bx1 - cx1, by1 - cy1, bx2 - cx1, by2 - cy1), "mask": full})
        track.best_score = score
        track.best = {"crop": crop, "containers": containers, "ts": track.last_ts}

    def _crop_containers(self, crop):
        """Посуда на вырезанном подносе: [{"kind", "conf", "box", "mask"}] в координатах crop."""
        h, w = crop.shape[:2]
        groups = assign_trays(self.detector.detect(crop), [(0, 0, w, h)])
        out = []
        for c in groups[0][1] if groups else []:
            x1, y1, x2, y2 = c.box
            full = np.zeros((h, w), bool)
            mh, mw = c.mask.shape
            full[y1:y1 + mh, x1:x1 + mw] = _hull_mask(c.mask)[:h - y1, :w - x1]
            out.append({"kind": c.kind, "conf": round(c.conf, 2), "box": c.box, "mask": full})
        return out

    def _finish(self, done):
        events = []
        for tid in [t.id for t in self.tracks.values() if done(t)]:
            t = self.tracks.pop(tid)
            if t.frames_seen < self.min_frames or not t.best:
                continue
            crop, containers = t.best["crop"], t.best["containers"]
            if self.belt:
                # На целом кадре посуда мелкая и модель теряет стаканы и миски. Рамка подноса
                # уже точная - смотрим ещё раз только на него, в увеличенном виде.
                containers = self._crop_containers(crop) or containers
            # На ленте поднос едет через кадр секунды: мелькнувшее пятно без посуды - не поднос
            # (край подноса при въезде, рука, тень), его нельзя записывать вторым подносом.
            if self.belt and not containers and t.frames_seen < 4:
                continue
            # Обрывок трека посреди проезда (трекер на миг потерял поднос) короче трети обычного
            # проезда - это тот же поднос, иначе он запишется дважды.
            if self.belt:
                typical = float(np.median(self.passes)) if len(self.passes) >= 3 else None
                if typical and t.frames_seen < 0.3 * typical:
                    continue
                self.passes = (self.passes + [t.frames_seen])[-20:]
            items, is_empty = leftovers.estimate(crop, containers)
            if self.belt:
                # «Всё съедено» без ИИ - только если нашли всю посуду, что обычно стоит на подносе:
                # не нашли миску - не знаем, доеден ли суп, и спрашиваем ИИ.
                usual = int(np.median(self.counts)) if len(self.counts) >= 3 else 2
                if len(containers) < max(2, usual):
                    is_empty = False
                self.counts = (self.counts + [len(containers)])[-20:]
            events.append(TrayEvent(
                track_id=t.id,
                crop=crop,
                containers=[{k: v for k, v in c.items() if k != "mask"} for c in containers],
                items=items,
                is_empty=is_empty,
                frames_seen=t.frames_seen,
                first_ts=t.first_ts,
                last_ts=t.last_ts,
                best_ts=t.best["ts"],
            ))
        return events
