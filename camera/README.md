# Камера над лентой (прототип)

Видео с камеры над лентой с подносами → модель на сервере находит подносы и тарелки
**без токенов** → пустые подносы записываются сразу, в ChatGPT уходят только подносы,
на которых что-то осталось.

```
видео/кадры ─► YOLOE (ONNX, 1 ядро) ─► трекинг подноса по ленте ─► 1 кадр на поднос
                                                                     │
                     тарелки пустые? ── да ──► «всё съедено», без ИИ ─┤
                                    └─ нет ──► ChatGPT + меню дня ────┴─► tray_scans
```

## Откуда модель

[YOLOE](https://github.com/THU-MIG/yoloe) из [Ultralytics](https://github.com/ultralytics/ultralytics)
(лицензия AGPL-3.0): находит объекты по словам без дообучения. Мы вшиваем в неё слова
`tray, plate, bowl, cup, food` и переводим в ONNX (11 МБ, вход 640×384).
На сервере нужен только `onnxruntime`: PyTorch и CLIP туда не ставятся.

## Что где

| Файл | Что делает |
| --- | --- |
| `trayeye_camera/detector.py` | Запуск ONNX + разбор выхода (рамки, NMS, маски) на numpy |
| `trayeye_camera/pipeline.py` | Тарелки → подносы, трекинг по ленте, лучший кадр подноса |
| `trayeye_camera/leftovers.py` | Оценка остатков без ИИ: доля тарелки, отличной по цвету от обода |
| `service.py` | Сервис `trayeye-vision` на 127.0.0.1:4110 (видео и живые кадры) |
| `export_model.py` | Готовит `models/trayeye-yoloe.onnx` (только на компе разработчика) |
| `tools/make_demo_video.py` | Тестовая лента с подносами и правильными ответами |
| `tools/run_video.py` | Прогон видео на своём компе: рамки, кадры подносов, сверка |
| `tools/make_web_demo.py` | Демо «экран камеры» для сайта (`/camera`): видео + рамки по кадрам в `web/public/demo/` |

Обновить демо на сайте другим видео: `python tools/make_web_demo.py <видео>`, затем на РФ-сервере
`npm run demo-camera -- <папка demo>` (ответы ИИ по подносам с остатками) и закоммитить `web/public/demo/`.

Node вызывает сервис из `server/src/services/camera.js`, в кабинете директора это
«Меню → Распознать остатки → Видео с камеры над лентой».

## Запуск у себя

```bash
py -3 -m venv .venv
.venv/Scripts/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/pip install -r requirements-dev.txt opencv-python
.venv/Scripts/python tools/make_demo_video.py --out samples/belt.mp4
.venv/Scripts/python tools/run_video.py samples/belt.mp4      # или 0 --show для веб-камеры
```

Сменили слова в `trayeye_camera/classes.py` → `python export_model.py`, и новую модель в git.

## Цифры (тестовая лента, 12 подносов)

- РФ-сервер, 1 ядро: **60 мс на кадр**, до 230 МБ памяти; минута видео при 3 кадрах/с - 13 с.
- Решение «звать ChatGPT или нет» верно для 12 из 12 подносов.
- В ChatGPT уходит один кадр подноса 10-25 КБ, а не видео.

Это синтетика из фото блюд: на настоящей камере пороги (`detector.CONF`,
`leftovers.FOOD_DELTA_E`) нужно подстроить по реальной записи.
