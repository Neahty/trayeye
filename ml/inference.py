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
            "plate_status": "unknown",
            "message": "No trained weights configured; image requires human review."
        }

    confidence_threshold = float(os.getenv("TRAYEYE_CONFIDENCE", "0.25"))
    if not 0 <= confidence_threshold <= 1:
        raise RuntimeError("TRAYEYE_CONFIDENCE must be between 0 and 1.")

    results = model.predict(source=image, conf=confidence_threshold, verbose=False)
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

    labels = {prediction["label"].strip().lower().replace("-", "_").replace(" ", "_")
              for prediction in predictions}
    food_detected = bool(labels - {"empty_plate"})
    if food_detected:
        plate_status = "food_detected"
        message = "Food detected; verify the result before recording it."
    elif "empty_plate" in labels:
        plate_status = "empty_detected"
        message = "An empty plate was detected; verify the result before recording it."
    else:
        plate_status = "unknown"
        message = "No supported objects detected; this does not prove the plate is empty. Human review required."

    return {
        "model_ready": True,
        "predictions": predictions,
        "plate_status": plate_status,
        "confidence_threshold": confidence_threshold,
        "message": message
    }
