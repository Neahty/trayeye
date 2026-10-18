"""Capture raw, unlabelled tray images from a local camera."""
import argparse
from datetime import datetime
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument("--output", default="data/food/raw", help="Directory for captured images")
    args = parser.parse_args()

    try:
        import cv2
    except ImportError as exc:
        raise SystemExit("OpenCV is required for camera capture. Install requirements-ml.txt first.") from exc

    camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        camera.release()
        raise SystemExit(
            f"Could not open camera {args.camera}. Check camera permissions or try --camera 1."
        )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    print("Camera ready. Press SPACE to save a frame; press Q to quit.")
    try:
        while True:
            ok, frame = camera.read()
            if not ok:
                print("Could not read a frame from the camera.")
                break
            cv2.imshow("TrayEye dataset capture", frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == 32:
                stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                destination = output_dir / f"tray_{stamp}.jpg"
                if cv2.imwrite(str(destination), frame):
                    print(f"Saved unlabelled image: {destination}")
                else:
                    print(f"Could not save image: {destination}")
    finally:
        camera.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()