import unittest
from unittest.mock import patch

from ml import inference


class _Scalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class _Box:
    def __init__(self, class_id, confidence):
        self.cls = _Scalar(class_id)
        self.conf = _Scalar(confidence)
        self.xyxy = [_Coordinates()]


class _Coordinates:
    def tolist(self):
        return [1.0, 2.0, 30.0, 40.0]


class _Model:
    def __init__(self, names, boxes):
        self.names = names
        self.boxes = boxes
        self.kwargs = None

    def predict(self, **kwargs):
        self.kwargs = kwargs
        return [type("Result", (), {"names": self.names, "boxes": self.boxes})()]


class InferenceTests(unittest.TestCase):
    def test_missing_weights_is_unknown_not_empty(self):
        with patch.object(inference, "_load_model", return_value=None):
            result = inference.predict(object())

        self.assertFalse(result["model_ready"])
        self.assertEqual(result["plate_status"], "unknown")

    def test_no_detections_is_unknown_not_empty(self):
        model = _Model({0: "fish"}, [])
        with patch.object(inference, "_load_model", return_value=model):
            result = inference.predict(object())

        self.assertEqual(result["plate_status"], "unknown")
        self.assertIn("does not prove", result["message"])

    def test_explicit_empty_plate_detection(self):
        model = _Model({0: "empty_plate"}, [_Box(0, 0.91)])
        with patch.object(inference, "_load_model", return_value=model):
            result = inference.predict(object())

        self.assertEqual(result["plate_status"], "empty_detected")
        self.assertEqual(result["predictions"][0]["label"], "empty_plate")
        self.assertEqual(model.kwargs["conf"], 0.25)

    def test_food_detection_takes_precedence_over_empty_plate(self):
        model = _Model({0: "empty_plate", 1: "fish"}, [_Box(0, 0.9), _Box(1, 0.8)])
        with patch.object(inference, "_load_model", return_value=model):
            result = inference.predict(object())

        self.assertEqual(result["plate_status"], "food_detected")


if __name__ == "__main__":
    unittest.main()