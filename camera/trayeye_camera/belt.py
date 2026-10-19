"""Подносы на ленте без нейросети: всё, что не похоже на саму ленту, - поднос.

Камера над лентой неподвижна, лента однородная. Модель фона запоминает, как выглядит
пустая лента вместе с бортами, и на каждом кадре даёт пятна «не лента».
Крупные плотные пятна - подносы. Это надёжнее, чем просить YOLOE найти «поднос»:
она его часто не узнаёт и собирает поднос из тарелок, тогда два соседних подноса
склеиваются, а поднос без найденной миски обрезается.

Подносы, поставленные вплотную, сливаются в одно пятно - его режем по типичной
ширине подноса, которую узнаём по отдельно стоящим подносам.
"""

import cv2
import numpy as np

WORK_W = 480            # пятна ищем на уменьшенном кадре: быстрее и меньше шума
MIN_AREA = 0.012        # пятно меньше этой доли кадра - не поднос (рука, салфетка, блик)
MIN_FILL = 0.55         # доля пятна в его рамке: поднос - плотный прямоугольник
MAX_MOVING = 0.5        # больше этой доли кадра «не лента» - камера не стоит на месте


DIFF = 28               # отличие от ленты (макс. по каналам BGR), выше - не лента
STILL = 2.0             # пиксель «стоит», если между кадрами изменился меньше этого
ABSORB = 18             # стоит на месте столько кадров (6 с при 3 кадрах/с) - это фон


class BeltSegmenter:
    """Своя модель фона вместо MOG2: та запоминала частые цвета подносов как «ленту»,
    и через пару минут серые подносы переставали находиться.

    Фон обновляется только там, где сейчас лента. Что-то, что лежит неподвижно дольше 6 с
    (лента встала, тень, предмет на борту), тоже уходит в фон: движущийся поднос стоит над
    одной точкой не дольше ~3 с, поэтому в фон не попадает.
    """

    def __init__(self, warmup=2):
        self.bg = None
        self.prev = None
        self.still = None
        self.seen = 0
        self.warmup = warmup
        self.widths = []      # ширины отдельно стоящих подносов -> типичная ширина

    def tray_width(self):
        return float(np.median(self.widths)) if len(self.widths) >= 3 else None

    def _foreground(self, small):
        img = small.astype(np.float32)
        if self.bg is None:
            self.bg, self.prev = img.copy(), img
            self.still = np.zeros(img.shape[:2], np.int32)
            return np.zeros(img.shape[:2], np.uint8)
        fg = np.abs(img - self.bg).max(axis=2) > DIFF
        still = np.abs(img - self.prev).max(axis=2) < STILL
        self.still = np.where(fg & still, self.still + 1, 0)
        absorb = (~fg) | (self.still > ABSORB)
        self.bg[absorb] = 0.9 * self.bg[absorb] + 0.1 * img[absorb]
        self.prev = img
        return (fg & (self.still <= ABSORB)).astype(np.uint8) * 255

    def boxes(self, frame):
        """Рамки подносов на кадре в пикселях исходного кадра; None - кадр не похож на ленту."""
        h, w = frame.shape[:2]
        k = WORK_W / w
        small = cv2.resize(frame, (WORK_W, int(round(h * k))), interpolation=cv2.INTER_AREA)
        small = cv2.GaussianBlur(small, (5, 5), 0)
        fg = self._foreground(small)
        self.seen += 1
        if self.seen <= self.warmup:
            return []
        # Изменилось больше половины кадра - камера движется (видео с рук), это не лента:
        # None - пусть конвейер группирует подносы по тарелкам, как раньше.
        if (fg > 0).mean() > MAX_MOVING:
            return None
        # Рёбра ленты и шум - тонкие: открытие их убирает, закрытие склеивает край подноса.
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        # Тарелки внутри подноса фон иногда принимает за ленту - заливаем внешний контур целиком.
        contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        fg = np.zeros_like(fg)
        cv2.drawContours(fg, contours, -1, 255, -1)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        n, _, stats, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
        sh, sw = fg.shape
        out = []
        for i in range(1, n):
            x, y, bw, bh, area = stats[i]
            if area < MIN_AREA * sw * sh or area < MIN_FILL * bw * bh:
                continue
            touches = x <= 1 or x + bw >= sw - 1
            parts = 1
            typical = self.tray_width()
            if typical and bw > 1.8 * typical * k and not touches:
                parts = int(round(bw / (typical * k)))
            elif not touches and area > 0.8 * bw * bh:
                # Ширину учим только по цельным, отдельно стоящим подносам.
                self.widths = (self.widths + [bw / k])[-30:]
            step = bw / max(1, parts)
            for p in range(parts):
                bx = x + p * step
                out.append((bx / k, y / k, (bx + step) / k, (y + bh) / k))
        return out
