"""Прогон видео через прототип на своём компе: что нашла модель, что ушло бы в ChatGPT.

    python tools/run_video.py samples/belt.mp4            # + сверка с samples/belt.json
    python tools/run_video.py 0 --show                    # веб-камера, окно с рамками

Пишет в samples/out/: вырезанные подносы, видео с рамками и events.json.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trayeye_camera.detector import Detector  # noqa: E402
from trayeye_camera.pipeline import TrayPipeline  # noqa: E402
from trayeye_camera.video import frames  # noqa: E402

COLORS = {"tray": (255, 160, 0), "plate": (0, 200, 255), "bowl": (0, 255, 160), "cup": (200, 120, 255), "food": (0, 0, 255)}


def draw(frame, pipe, stats):
    out = frame.copy()
    for d in pipe.last_dets:
        x1, y1, x2, y2 = d.box
        cv2.rectangle(out, (x1, y1), (x2, y2), COLORS[d.kind], 2)
        cv2.putText(out, f"{d.kind} {d.conf:.2f}", (x1 + 3, y1 + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, COLORS[d.kind], 1, cv2.LINE_AA)
    for tid, (x1, y1, x2, y2) in pipe.last_groups:
        cv2.rectangle(out, (int(x1) - 6, int(y1) - 6), (int(x2) + 6, int(y2) + 6), (255, 255, 255), 2)
        cv2.putText(out, f"TRAY #{tid}", (int(x1), int(y1) - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    text = f"trays {stats['trays']}  -> GPT {stats['gpt']}  skipped (empty) {stats['skipped']}  {stats['ms']:.0f} ms/frame"
    cv2.rectangle(out, (0, 0), (out.shape[1], 30), (0, 0, 0), -1)
    cv2.putText(out, text, (10, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def compare(events, truth_path):
    if not truth_path.exists():
        return
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    print(f"\nСверка с {truth_path.name}: подносов в видео {len(truth)}, найдено {len(events)}")
    right, matched = 0, set()
    for tr in truth:
        food = {it["dish"]: it["leftover_pct"] for it in tr["items"]}
        # Найденный поднос, чей лучший кадр ближе всего ко времени, когда настоящий был в центре.
        near = [e for e in events if e["track_id"] not in matched and abs(e["best_ts"] - tr["center_ts"]) <= 3]
        ev = min(near, key=lambda e: abs(e["best_ts"] - tr["center_ts"]), default=None)
        if ev is None:
            print(f"  поднос {tr['tray']:>2}  правда: {food}  ->  НЕ НАЙДЕН")
            continue
        matched.add(ev["track_id"])
        # Напитки модель на синтетике видит плохо, поэтому «пусто» - по тарелкам.
        plates_empty = all(it["leftover_pct"] == 0 for it in tr["items"][:2])
        ok = ev["is_empty"] == plates_empty
        right += ok
        local = [f"{it['kind']} {it['leftover_pct']}" for it in ev["items"]]
        print(f"  поднос {tr['tray']:>2}  правда: {food}  ->  #{ev['track_id']} локально {local}, "
              f"{'пусто' if ev['is_empty'] else 'в GPT'}  {'OK' if ok else 'ОШИБКА'}")
    extra = [e["track_id"] for e in events if e["track_id"] not in matched]
    print(f"Решение «звать ChatGPT или нет» верно: {right}/{len(truth)}. Лишние подносы: {extra or 'нет'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("source")
    ap.add_argument("--fps", type=float, default=3.0)
    ap.add_argument("--threads", type=int, default=1)
    ap.add_argument("--out", default="samples/out")
    ap.add_argument("--show", action="store_true")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    pipe = TrayPipeline(Detector(threads=args.threads))
    stats = {"trays": 0, "gpt": 0, "skipped": 0, "ms": 0.0}
    events, writer, times = [], None, []

    def handle(evs):
        for ev in evs:
            stats["trays"] += 1
            stats["skipped" if ev.is_empty else "gpt"] += 1
            cv2.imencode(".jpg", ev.crop)[1].tofile(str(out_dir / f"tray-{ev.track_id}.jpg"))
            events.append({"track_id": ev.track_id, "is_empty": ev.is_empty, "items": ev.items,
                           "containers": ev.containers, "frames_seen": ev.frames_seen,
                           "first_ts": round(ev.first_ts, 2), "last_ts": round(ev.last_ts, 2),
                           "best_ts": round(ev.best_ts, 2),
                           "crop_kb": round(len(cv2.imencode(".jpg", ev.crop)[1]) / 1024, 1)})

    for ts, frame in frames(args.source, fps=args.fps):
        t = time.perf_counter()
        handle(pipe.process(frame, ts))
        times.append((time.perf_counter() - t) * 1000)
        stats["ms"] = sum(times[-20:]) / len(times[-20:])
        vis = draw(frame, pipe, stats)
        if writer is None:
            writer = cv2.VideoWriter(str(out_dir / "annotated.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, vis.shape[1::-1])
        writer.write(vis)
        if args.show:
            cv2.imshow("TrayEye camera", vis)
            if cv2.waitKey(1) & 0xFF == 27:
                break
    handle(pipe.flush())
    if writer:
        writer.release()

    (out_dir / "events.json").write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Кадров: {len(times)}, среднее {sum(times) / max(1, len(times)):.0f} мс/кадр. "
          f"Подносов: {stats['trays']}, в ChatGPT: {stats['gpt']}, пропущено пустых: {stats['skipped']}")
    if not str(args.source).isdigit():
        compare(events, Path(args.source).with_suffix(".json"))


if __name__ == "__main__":
    main()
