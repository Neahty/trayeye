"""Демо «экран камеры» для сайта: видео ленты + что на каждом кадре нашла модель.

    python tools/make_web_demo.py samples/belt.mp4

Прогоняет видео через тот же конвейер, что и сервис камеры (YOLOE + трекинг + локальная
оценка остатков), и пишет в web/public/demo/:
  camera.mp4      - видео в H.264 (его играет браузер), нужен ffmpeg;
  camera.json     - рамки подносов и посуды по кадрам и события «поднос проехал»;
  trays/tray-N.jpg - кадр подноса, который ушёл бы в ИИ.
Ответы ИИ по подносам с остатками добавляет server/scripts/demo-ai.js (ключи - на сервере).
Сайт ничего не считает сам: страница /camera просто проигрывает записанное.
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trayeye_camera.detector import Detector  # noqa: E402
from trayeye_camera.pipeline import TrayPipeline, assign_trays  # noqa: E402
from trayeye_camera.video import frames, jpeg  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "web" / "public" / "demo"


def box(b):
    return [int(round(v)) for v in b]


def encode_video(src, dst):
    """Видео для браузера: H.264 в исходном размере и частоте кадров (60 у make_demo_video.py).
    Рамки в camera.json - в пикселях уменьшенного кадра, страница растягивает их по размеру видео."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("Нужен ffmpeg: браузеры не играют mp4v, который пишет OpenCV.")
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(src), "-an", "-c:v", "libx264",
                    "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst)],
                   check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    # 3 кадра/с, как у сервиса камеры: на 5 трекер чаще рвёт поднос на два.
    ap.add_argument("--fps", type=float, default=3.0, help="сколько кадров в секунду смотрит модель")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out = Path(args.out)
    if (out / "trays").exists():
        shutil.rmtree(out / "trays")
    (out / "trays").mkdir(parents=True)

    pipe = TrayPipeline(Detector(threads=2), belt=True)
    timeline, events, size = [], [], None

    def handle(evs):
        for ev in evs:
            name = f"trays/tray-{ev.track_id}.jpg"
            (out / name).write_bytes(jpeg(ev.crop))
            events.append({
                "id": ev.track_id,
                # Поднос «проехал», когда модель перестала его видеть: тогда и появляется результат.
                "t": round(ev.last_ts, 2),
                "best_t": round(ev.best_ts, 2),
                "first_t": round(ev.first_ts, 2),
                "empty": ev.is_empty,
                "local": [{"kind": it["kind"], "leftover_pct": it["leftover_pct"]} for it in ev.items],
                "crop": name,
            })

    for ts, frame in frames(args.source, fps=args.fps):
        size = frame.shape[1::-1]
        handle(pipe.process(frame, ts))
        # Посуду рисуем ту же, что конвейер отнёс к подносам: без «тарелки» размером с поднос и повторов.
        members = assign_trays(pipe.last_dets, [b for _, b in pipe.last_groups])
        timeline.append({
            "t": round(ts, 2),
            "trays": [[tid, *box(b)] for tid, b in pipe.last_groups],
            "dets": [[d.kind, *box(d.box)] for _, group in members for d in group],
        })
    handle(pipe.flush())

    encode_video(args.source, out / "camera.mp4")
    events.sort(key=lambda e: e["t"])
    # Меню обеда из разметки тестовой ленты (make_demo_video.py): его получает ИИ, как в школе.
    truth_path = Path(args.source).with_suffix(".json")
    if truth_path.exists():
        truth = json.loads(truth_path.read_text(encoding="utf-8"))
        for e in events:
            mid = (e["first_t"] + e["t"]) / 2
            near = [t for t in truth if e["first_t"] <= t["center_ts"] <= e["t"]]
            tr = min(near, key=lambda t: abs(t["center_ts"] - mid), default=None)
            if tr and tr.get("menu"):
                e["menu"] = tr["menu"]
    for e in events:
        e.pop("first_t", None)
    data = {"width": size[0], "height": size[1], "fps": args.fps, "frames": timeline, "events": events}
    (out / "camera.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    empty = sum(e["empty"] for e in events)
    print(f"Кадров: {len(timeline)}, подносов: {len(events)}, пустых (без ИИ): {empty}, в ИИ: {len(events) - empty}")
    print(f"Готово: {out}")


if __name__ == "__main__":
    main()
