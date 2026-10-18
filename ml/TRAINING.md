# Train the TrayEye food model

## Important
This repository does not include a pretrained model trained for cafeteria leftovers or a labelled dataset. The class names in the example YAML are a starting schema only. The model will not become accurate just by running the script without correctly annotated images.

## Prepare data
The repository includes `data/food.yaml` and empty folders ready for images and annotations:
```
data/
  food.yaml
  food/
    images/
      train/
      val/
      test/
    labels/
      train/
      val/
      test/
```
`empty_plate` is class 9. Annotate representative empty plates explicitly if you want the model to identify them; no detections alone are never treated as proof that a plate is empty. Do not put raw camera captures into the training folders until each image has a matching annotation file.

To capture raw images from a local webcam, install the ML dependencies and run `python -m ml.capture`. Press Space to save an image and Q to quit. Captures go to `data/food/raw` by default and still need human annotation and a split by collection session. If the camera is unavailable, check OS camera permissions or try `--camera 1`.

Run `python -m unittest discover -s tests -v` to check inference and dataset validation. Run `python -m ml.train --data data/food.yaml` only after both train and validation splits contain images and YOLO-format labels; the training command validates these files before starting.

For every image, create a matching YOLO-format text file in the labels folder. Split images from the same video/session into the same split to reduce leakage. Use a held-out test set from different days/camera conditions for evaluation. Get permission before collecting images in a school.

## Train
```bash
pip install -r requirements-ml.txt
python -m ml.train --data data/food.yaml --epochs 50 --imgsz 640
```
Use `--device 0` if a compatible CUDA GPU is available. CPU training may be very slow.

## Connect trained weights
Set `TRAYEYE_MODEL_PATH` to the generated `best.pt` path in the API environment and restart the server. Do not commit large weights or images to Git; use private model storage or release artifacts with access controls.

## What this model measures
A detector predicts object classes and bounding boxes, not the exact weight or percentage of food left. Estimating waste amount may require segmentation, scale calibration, and labelled portion measurements. Always show confidence and keep a staff review workflow for uncertain predictions.
