"""Optional YOLO inference adapter for TrayEye.

Install the optional dependency with: pip install ultralytics
Set TRAYEYE_MODEL_PATH to a trained weights file (for example best.pt).
The model must be trained for the food classes you need; generic pretrained
weights are not a validated food-waste model.
"""
import os
from functools import lru_cache
from pathlib import Path

@lru_cache(maxsize=1)
def _load_model():
    weights = os.getenv("TRAYEYE_MODEL_PATH", "").strip()
    if not weights or not Path(weights).is_file():
        return None
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError("A model path is configured, but ultralytics is not installed. Run: pip install ultralytics") from exc
    return YOLO(weights)

def predict(image):
    """Return a JSON-safe prediction or explicit needs-review status."""
    model = _load_model()
    if model is None:
        return {
            "model_ready": False,
            "predictions": [],
            "message": "No trained weights configured; image requires human review."
        }
    results = model.predict(source=image, verbose=False)
    predictions = []
    if results:
        result = results[0]
        names = result.names
        boxes = getattr(result, "boxes", None)
        if boxes is not None:
            for box in boxes:
                cls_id = int(box.cls.item())
                predictions.append({
                    "label": str(names.get(cls_id, cls_id)),
                    "confidence": round(float(box.conf.item()), 4),
                    "box_xyxy": [round(float(v), 2) for v in box.xyxy[0].tolist()]
                })
    return {
        "model_ready": True,
        "predictions": predictions,
        "message": "Predictions are model outputs, not verified measurements of how much food remains."
    }
