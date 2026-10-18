"""Validation helpers for the TrayEye YOLO detection dataset."""
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


class DatasetValidationError(ValueError):
    """Raised when a YOLO dataset is incomplete or malformed."""


def validate_dataset(data_yaml: str | Path) -> Path:
    """Validate dataset paths, class names, image-label pairs, and YOLO rows."""
    config_path = Path(data_yaml).resolve()
    if not config_path.is_file():
        raise DatasetValidationError(f"Dataset config not found: {config_path}")

    try:
        import yaml
    except ImportError as exc:
        raise DatasetValidationError(
            "PyYAML is required to validate the dataset. Install requirements-ml.txt."
        ) from exc

    try:
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise DatasetValidationError(f"Cannot read dataset YAML: {exc}") from exc
    if not isinstance(config, dict):
        raise DatasetValidationError("Dataset YAML must contain a mapping.")

    names = config.get("names")
    if isinstance(names, list):
        class_names = names
    elif isinstance(names, dict) and all(str(key).isdigit() for key in names):
        indexed_names = {int(key): value for key, value in names.items()}
        if sorted(indexed_names) != list(range(len(indexed_names))):
            raise DatasetValidationError("Class IDs in names must start at 0 and be consecutive.")
        class_names = [indexed_names[index] for index in range(len(indexed_names))]
    else:
        raise DatasetValidationError("Dataset YAML must define names as a list or consecutive ID mapping.")
    if not class_names or any(not isinstance(name, str) or not name.strip() for name in class_names):
        raise DatasetValidationError("Dataset class names must be non-empty strings.")

    dataset_root = Path(config.get("path", "."))
    if not dataset_root.is_absolute():
        dataset_root = config_path.parent / dataset_root

    for split in ("train", "val"):
        split_value = config.get(split)
        if not isinstance(split_value, str) or not split_value.strip():
            raise DatasetValidationError(f"Dataset YAML must define a {split} image directory.")
        image_dir = Path(split_value)
        if not image_dir.is_absolute():
            image_dir = dataset_root / image_dir
        label_dir = _label_directory(image_dir)
        if not image_dir.is_dir():
            raise DatasetValidationError(f"{split} image directory does not exist: {image_dir}")
        images = [path for path in image_dir.rglob("*")
                  if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES]
        if not images:
            raise DatasetValidationError(f"No images found in {split} directory: {image_dir}")
        if not label_dir.is_dir():
            raise DatasetValidationError(f"{split} label directory does not exist: {label_dir}")

        for image_path in images:
            label_path = label_dir / image_path.relative_to(image_dir).with_suffix(".txt")
            if not label_path.is_file():
                raise DatasetValidationError(f"Missing annotation for image: {image_path}")
            _validate_label_file(label_path, len(class_names))

    return config_path


def _label_directory(image_dir: Path) -> Path:
    parts = list(image_dir.parts)
    try:
        index = len(parts) - 1 - parts[::-1].index("images")
    except ValueError:
        return image_dir.parent / "labels" / image_dir.name
    parts[index] = "labels"
    return Path(*parts)


def _validate_label_file(label_path: Path, class_count: int) -> None:
    try:
        rows = label_path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise DatasetValidationError(f"Cannot read annotation {label_path}: {exc}") from exc

    for line_number, row in enumerate(rows, start=1):
        values = row.split()
        if len(values) != 5:
            raise DatasetValidationError(
                f"{label_path}:{line_number}: expected 5 YOLO values, got {len(values)}."
            )
        try:
            class_id = int(values[0])
            coordinates = [float(value) for value in values[1:]]
        except ValueError as exc:
            raise DatasetValidationError(
                f"{label_path}:{line_number}: class ID and coordinates must be numeric."
            ) from exc
        if not 0 <= class_id < class_count:
            raise DatasetValidationError(
                f"{label_path}:{line_number}: class ID {class_id} is outside 0..{class_count - 1}."
            )
        if any(value < 0 or value > 1 for value in coordinates):
            raise DatasetValidationError(
                f"{label_path}:{line_number}: normalized coordinates must be between 0 and 1."
            )
        if coordinates[2] <= 0 or coordinates[3] <= 0:
            raise DatasetValidationError(
                f"{label_path}:{line_number}: box width and height must be greater than 0."
            )