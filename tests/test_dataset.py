import tempfile
import unittest
from pathlib import Path

from ml.dataset import DatasetValidationError, validate_dataset


class DatasetValidationTests(unittest.TestCase):
    def setUp(self):
        try:
            import yaml  # noqa: F401
        except ImportError:
            self.skipTest("PyYAML is an optional ML dependency")
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.config = self.root / "food.yaml"
        self._write_config()
        for split in ("train", "val"):
            (self.root / "food/images" / split).mkdir(parents=True)
            (self.root / "food/labels" / split).mkdir(parents=True)
            (self.root / f"food/images/{split}/sample.jpg").write_bytes(b"test image placeholder")
            (self.root / f"food/labels/{split}/sample.txt").write_text("9 0.5 0.5 0.4 0.4\n", encoding="utf-8")

    def tearDown(self):
        if hasattr(self, "temp_dir"):
            self.temp_dir.cleanup()

    def _write_config(self):
        self.config.write_text(
            "path: food\ntrain: images/train\nval: images/val\nnames:\n"
            "  0: fish\n  1: vegetables\n  2: potatoes\n  3: pasta\n"
            "  4: rice\n  5: meat\n  6: soup\n  7: bread\n"
            "  8: fruit\n  9: empty_plate\n",
            encoding="utf-8",
        )

    def test_valid_dataset_passes(self):
        self.assertEqual(validate_dataset(self.config), self.config.resolve())

    def test_missing_annotation_is_rejected(self):
        (self.root / "food/labels/val/sample.txt").unlink()

        with self.assertRaisesRegex(DatasetValidationError, "Missing annotation"):
            validate_dataset(self.config)

    def test_nonconsecutive_class_ids_are_rejected(self):
        self.config.write_text(
            "path: food\ntrain: images/train\nval: images/val\nnames:\n  0: fish\n  9: empty_plate\n",
            encoding="utf-8",
        )

        with self.assertRaisesRegex(DatasetValidationError, "consecutive"):
            validate_dataset(self.config)

    def test_out_of_range_coordinates_are_rejected(self):
        (self.root / "food/labels/train/sample.txt").write_text(
            "0 1.2 0.5 0.4 0.4\n", encoding="utf-8"
        )

        with self.assertRaisesRegex(DatasetValidationError, "between 0 and 1"):
            validate_dataset(self.config)

    def test_empty_annotation_file_is_allowed(self):
        (self.root / "food/labels/train/sample.txt").write_text("", encoding="utf-8")

        self.assertEqual(validate_dataset(self.config), self.config.resolve())


if __name__ == "__main__":
    unittest.main()