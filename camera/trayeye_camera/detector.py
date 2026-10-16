"""YOLOE в ONNX без PyTorch: onnxruntime + numpy. Так модель влезает на слабый сервер.

Выход модели (Ultralytics, сегментация):
  output0 [1, 4 + классы + 32, N] - рамки cx,cy,w,h, уверенность по классам, коэффициенты маски;
  output1 [1, 32, H/4, W/4]       - прототипы масок.
"""

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .classes import CLASSES

MODEL_DIR = Path(__file__).resolve().parents[1] / "models"

# Свой порог на каждый класс: поднос модель видит хуже тарелок, пустые белые тарелки -
# с уверенностью 0.25-0.4. Ложные «тарелки» без подноса рядом отсеет трекинг (min_frames).
CONF = {"tray": 0.25, "plate": 0.2, "bowl": 0.2, "cup": 0.2, "food": 0.15}
IOU = 0.5


@dataclass
class Detection:
    kind: str
    conf: float
    box: tuple          # x1, y1, x2, y2 в пикселях исходного кадра
    mask: np.ndarray = None  # bool внутри box (shape = высота x ширина рамки)

    def center(self):
        x1, y1, x2, y2 = self.box
        return (x1 + x2) / 2, (y1 + y2) / 2


class Detector:
    def __init__(self, model_path=None, threads=1):
        model_path = Path(model_path or MODEL_DIR / "trayeye-yoloe.onnx")
        meta_path = model_path.with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        if meta.get("classes", CLASSES) != CLASSES:
            raise ValueError("Модель экспортирована с другими классами, запустите export_model.py заново")
        opts = ort.SessionOptions()
        # На сервере 2 ядра и соседи: по умолчанию берём одно.
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        # Вход бывает прямоугольным (640x384 под кадр 16:9).
        self.in_h, self.in_w = self.session.get_inputs()[0].shape[2:4]

    def _letterbox(self, frame):
        h, w = frame.shape[:2]
        scale = min(self.in_h / h, self.in_w / w)
        nh, nw = round(h * scale), round(w * scale)
        top, left = (self.in_h - nh) // 2, (self.in_w - nw) // 2
        canvas = np.full((self.in_h, self.in_w, 3), 114, np.uint8)
        canvas[top:top + nh, left:left + nw] = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
        blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        return np.ascontiguousarray(blob), scale, left, top

    def detect(self, frame, with_masks=("plate", "bowl", "cup")):
        """Все находки на кадре. Маски считаем только для нужных классов: это самая дорогая часть."""
        blob, scale, left, top = self._letterbox(frame)
        out0, protos = self.session.run(None, {self.input_name: blob})
        pred = out0[0].T                      # [N, 4 + C + 32]
        nc = len(CLASSES)
        scores = pred[:, 4:4 + nc]
        cls = scores.argmax(1)
        conf = scores[np.arange(len(cls)), cls]
        thresholds = np.array([CONF[c] for c in CLASSES])
        keep = conf >= thresholds[cls]
        if not keep.any():
            return []
        pred, cls, conf = pred[keep], cls[keep], conf[keep]

        cx, cy, bw, bh = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
        boxes = np.stack([cx - bw / 2, cy - bh / 2, bw, bh], 1)  # для NMS: x, y, w, h во входе модели
        idx = cv2.dnn.NMSBoxesBatched(boxes.tolist(), conf.tolist(), cls.tolist(), 0.0, IOU)
        idx = np.array(idx).reshape(-1)

        h, w = frame.shape[:2]
        proto = protos[0]
        ph, pw = proto.shape[1:]
        result = []
        for i in idx:
            x, y, bw_i, bh_i = boxes[i]
            # Из координат входа модели (с полями) - в пиксели исходного кадра.
            x1 = int(np.clip((x - left) / scale, 0, w))
            y1 = int(np.clip((y - top) / scale, 0, h))
            x2 = int(np.clip((x + bw_i - left) / scale, 0, w))
            y2 = int(np.clip((y + bh_i - top) / scale, 0, h))
            if x2 - x1 < 4 or y2 - y1 < 4:
                continue
            det = Detection(CLASSES[cls[i]], float(conf[i]), (x1, y1, x2, y2))
            if det.kind in with_masks:
                det.mask = self._mask(pred[i, 4 + nc:], proto, (x, y, bw_i, bh_i), ph, pw, scale, left, top, det.box)
            result.append(det)
        return result

    def _mask(self, coefs, proto, box_in, ph, pw, scale, left, top, box):
        """Маска объекта внутри его рамки: коэффициенты x прототипы, только в области рамки."""
        ratio = ph / self.in_h  # прототипы в 4 раза меньше входа по обеим сторонам
        x, y, bw, bh = box_in
        px1, py1 = int(max(0, np.floor(x * ratio))), int(max(0, np.floor(y * ratio)))
        px2, py2 = int(min(pw, np.ceil((x + bw) * ratio))), int(min(ph, np.ceil((y + bh) * ratio)))
        if px2 <= px1 or py2 <= py1:
            return None
        part = proto[:, py1:py2, px1:px2]
        logits = np.tensordot(coefs, part, axes=(0, 0))
        x1, y1, x2, y2 = box
        # Область прототипа в пикселях кадра может быть чуть шире рамки - растягиваем и обрезаем.
        fx1, fy1 = (px1 / ratio - left) / scale, (py1 / ratio - top) / scale
        fx2, fy2 = (px2 / ratio - left) / scale, (py2 / ratio - top) / scale
        full_w, full_h = max(1, round(fx2 - fx1)), max(1, round(fy2 - fy1))
        up = cv2.resize(logits.astype(np.float32), (full_w, full_h), interpolation=cv2.INTER_LINEAR)
        ox, oy = int(round(x1 - fx1)), int(round(y1 - fy1))
        crop = up[max(0, oy):max(0, oy) + (y2 - y1), max(0, ox):max(0, ox) + (x2 - x1)]
        mask = np.zeros((y2 - y1, x2 - x1), bool)
        mask[:crop.shape[0], :crop.shape[1]] = crop > 0  # sigmoid(x) > 0.5  <=>  x > 0
        return mask
