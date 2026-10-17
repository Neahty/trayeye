"""Train a YOLO food detector using a dataset in Ultralytics YOLO format.

Dataset layout:
  data/food.yaml
  data/images/train/*.jpg
  data/images/val/*.jpg
  data/labels/train/*.txt
  data/labels/val/*.txt

Each label file uses standard YOLO rows: class_id x_center y_center width height
(normalized 0..1). You must create real annotations before training.
"""
import argparse
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/food.yaml", help="Path to dataset YAML")
    parser.add_argument("--weights", default="yolo11n.pt", help="Initial pretrained checkpoint")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="", help="e.g. 0 for GPU; leave blank for auto")
    parser.add_argument("--project", default="runs/trayeye")
    parser.add_argument("--name", default="food-detection")
    args = parser.parse_args()

    if not Path(args.data).is_file():
        raise SystemExit(
            f"Dataset config not found: {args.data}\n"
            "Copy data/food.example.yaml to data/food.yaml and prepare annotated train/val images first."
        )
    try:
        from ultralytics import YOLO
    except ImportError:
        raise SystemExit("Missing training dependency. Install with: pip install -r requirements-ml.txt")

    model = YOLO(args.weights)
    kwargs = dict(data=args.data, epochs=args.epochs, imgsz=args.imgsz,
                  batch=args.batch, project=args.project, name=args.name)
    if args.device:
        kwargs["device"] = args.device
    result = model.train(**kwargs)
    print("Training finished. Best checkpoint is usually at:")
    print(Path(args.project) / args.name / "weights" / "best.pt")
    print("Validate the model on held-out cafeteria images before deployment.")
    return result

if __name__ == "__main__":
    main()
