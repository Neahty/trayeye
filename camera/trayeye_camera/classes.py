"""Что ищет модель. Порядок = номер класса в ONNX, менять только вместе с export_model.py."""

CLASSES = ["tray", "plate", "bowl", "cup", "food"]

# Слова-подсказки для YOLOE (английские: так модель обучалась). Можно уточнять,
# например "plastic cafeteria tray", после чего модель нужно экспортировать заново.
PROMPTS = {
    "tray": "tray",
    "plate": "plate",
    "bowl": "bowl",
    "cup": "cup",
    "food": "food",
}

CONTAINERS = ("plate", "bowl", "cup")
