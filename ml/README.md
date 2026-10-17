# TrayEye camera ML adapter

The repository contains an optional inference adapter, not trained weights.

1. Collect representative cafeteria tray images with appropriate permission.
2. Annotate visible food categories (and, if needed, remaining-food masks/area).
3. Train a detector/segmenter and evaluate it on a separate test set.
4. Install optional dependency: `pip install ultralytics`.
5. Set `TRAYEYE_MODEL_PATH=/absolute/path/to/best.pt` in the ML server environment.
6. Restart the API and test with images from the actual camera position.

A generic object detector does not automatically recognize fish, vegetables, or the amount eaten. For waste quantity, segmentation and calibration against real examples may be needed. All uncertain detections should remain reviewable by staff. Do not use this model to identify children or infer student identity.
