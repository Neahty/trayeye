# Train the TrayEye food model

## Important
This repository does not include a pretrained model trained for cafeteria leftovers or a labelled dataset. The class names in the example YAML are a starting schema only. The model will not become accurate just by running the script without correctly annotated images.

## Prepare data
Create the following structure:
```
data/
  food.yaml
  food/
    images/
      train/
      val/
    labels/
      train/
      val/
```
Copy `data/food.example.yaml` to `data/food.yaml` and change `path` to `data/food`.
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
