"""Готовит модель для сервера: YOLOE со вшитыми словами -> один файл ONNX.

Запускается на компе разработчика (нужны torch и ultralytics, см. requirements-dev.txt).
На сервере потом нужен только onnxruntime: ни PyTorch, ни CLIP туда не ставим.

    python export_model.py                 # yoloe-26n-seg, вход 640x384 -> models/trayeye-yoloe.onnx
    python export_model.py --weights yoloe-26s-seg.pt --imgsz 480

Вход прямоугольный 16:9, как кадр камеры: квадрат 480 тратит половину пикселей
на поля, и мелкие пустые тарелки модель тогда не видит.
"""

import argparse
import json
import shutil
from pathlib import Path

from ultralytics import YOLOE

from trayeye_camera.classes import CLASSES, PROMPTS

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="yoloe-26n-seg.pt")
    ap.add_argument("--imgsz", default="384,640", help="высота,ширина или одно число для квадрата")
    args = ap.parse_args()
    imgsz = [int(v) for v in args.imgsz.split(",")]
    imgsz = imgsz if len(imgsz) == 2 else imgsz[0]

    weights = HERE / "weights" / args.weights
    weights.parent.mkdir(exist_ok=True)
    # Ultralytics сам скачает веса из релизов GitHub, если их ещё нет.
    model = YOLOE(str(weights) if weights.exists() else args.weights)
    prompts = [PROMPTS[c] for c in CLASSES]
    model.set_classes(prompts, model.get_text_pe(prompts))
    exported = Path(model.export(format="onnx", imgsz=imgsz, simplify=True, dynamic=False))

    out_dir = HERE / "models"
    out_dir.mkdir(exist_ok=True)
    target = out_dir / "trayeye-yoloe.onnx"
    shutil.move(str(exported), target)
    (out_dir / "trayeye-yoloe.json").write_text(json.dumps({
        "source": args.weights,
        "imgsz": imgsz,
        "classes": CLASSES,
        "prompts": prompts,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{target} ({target.stat().st_size / 1e6:.1f} МБ)")


if __name__ == "__main__":
    main()
