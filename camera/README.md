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
| `trayeye_camera/belt.py` | Подносы на ленте по фону: всё, что не лента, - поднос (YOLOE «поднос» узнаёт плохо) |
| `trayeye_camera/pipeline.py` | Подносы + посуда, трекинг по ленте, лучший кадр, повторный поиск посуды на вырезке подноса |
| `trayeye_camera/leftovers.py` | Оценка остатков без ИИ: цвет и зернистость еды на тарелке, цветные пятна на подносе |
| `service.py` | Сервис `trayeye-vision` на 127.0.0.1:4110 (видео и живые кадры) |
| `export_model.py` | Готовит `models/trayeye-yoloe.onnx` (только на компе разработчика) |
| `tools/make_demo_video.py` | Тестовая лента 60 кадров/с (обеды по 10 подносов со своим меню) и правильные ответы |
| `tools/eval_belt.py` | Проверка точности: найденные подносы и решение «пусто или в ИИ» против правильных ответов |
| `tools/run_video.py` | Прогон видео на своём компе: рамки, кадры подносов, сверка |
| `tools/make_web_demo.py` | Демо «экран камеры» для сайта (`/camera`): видео + рамки по кадрам в `web/public/demo/` |

Обновить демо на сайте другим видео: `python tools/make_web_demo.py <видео>`, затем на РФ-сервере
`npm run demo-camera -- <папка demo>` (ответы ИИ по подносам с остатками) и закоммитить `web/public/demo/`.
Точность ИИ: `tools/eval_belt.py` готовит `ai-set/`, на сервере `npm run eval-ai -- <ai-set> --model ...`.

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

## Цифры (тестовые ленты по 5 минут, 55 подносов; A - настройка, B - контроль)

Детекция (`tools/eval_belt.py`), обе ленты:
- найдено 55 из 55 подносов, лишних 0;
- «пусто или в ИИ» верно 54-55 из 55, ни одного подноса с остатками, записанного «всё съедено».

ИИ на ленте B (`npm run eval-ai`, меню обеда как в школе):

| | flash-lite, старый запрос | flash-lite, новый | 3.8-flash, новый |
| --- | --- | --- | --- |
| ошибка остатка еды, п.п. | 19.5 | 9-13 | 8-10 |
| в пределах ±20 п.п. | 66% | 86-90% | 87-92% |
| ответов «50» (по правде 28 из 165) | 27 | 3-5 | 4-9 |

Напитки сверху ИИ оценивает плохо (ошибка 25-40 п.п.): уровень в стакане сверху почти не виден.

Это синтетика из фото блюд: на настоящей камере пороги (`detector.CONF`, `leftovers.FOOD_DELTA_E`,
`leftovers.TEXTURE_SD`, `belt.DIFF`) нужно проверить по реальной записи с разметкой.
