"""Проверка точности камеры на ленте с известными ответами (её делает make_demo_video.py).

    python tools/eval_belt.py samples/eval-a.mp4 [--out samples/eval-a]

Сверяет найденные подносы с правильными (samples/eval-a.json) и пишет:
  report.json - найдено/пропущено/лишние, верность решения «пусто или в ИИ»;
  ai-set/     - кадры подносов, которые ушли бы в ИИ, и правильные ответы к ним
                (truth.json) - их проверяет server/src/db/eval-ai-cli.js.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trayeye_camera.detector import Detector  # noqa: E402
from trayeye_camera.pipeline import TrayPipeline  # noqa: E402
from trayeye_camera.video import frames, jpeg  # noqa: E402

def match(events, truth):
    """Найденный поднос -> настоящий: трек, который шёл, когда настоящий поднос был в центре кадра
    (лучший кадр трека бывает на пару секунд раньше центра), ближайший серединой к этому моменту."""
    pairs, used = [], set()
    for tr in truth:
        c = tr["center_ts"]
        near = [e for e in events if e["track_id"] not in used and e["first_ts"] <= c <= e["last_ts"]]
        ev = min(near, key=lambda e: abs((e["first_ts"] + e["last_ts"]) / 2 - c), default=None)
        if ev:
            used.add(ev["track_id"])
        pairs.append((tr, ev))
    extra = [e for e in events if e["track_id"] not in used]
    return pairs, extra


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out")
    ap.add_argument("--fps", type=float, default=3.0)
    args = ap.parse_args()

    video = Path(args.video)
    out = Path(args.out or video.with_suffix(""))
    if out.exists():
        shutil.rmtree(out)
    (out / "ai-set").mkdir(parents=True)
    truth = json.loads(video.with_suffix(".json").read_text(encoding="utf-8"))

    pipe = TrayPipeline(Detector(threads=2), belt=True)
    events, crops = [], {}

    def handle(evs):
        for ev in evs:
            crops[ev.track_id] = ev.crop
            events.append({"track_id": ev.track_id, "is_empty": ev.is_empty, "best_ts": round(ev.best_ts, 2),
                           "first_ts": ev.first_ts, "last_ts": ev.last_ts,
                           "items": [{"kind": i["kind"], "leftover_pct": i["leftover_pct"]} for i in ev.items]})

    for ts, frame in frames(str(video), fps=args.fps):
        handle(pipe.process(frame, ts))
    handle(pipe.flush())

    pairs, extra = match(events, truth)
    found = [(tr, ev) for tr, ev in pairs if ev]
    # «Пусто» по правде: доедено и допито всё - недопитый компот тоже повод спросить ИИ.
    def plates_empty(tr):
        return all(it["leftover_pct"] == 0 for it in tr["items"])

    right_empty = sum(ev["is_empty"] == plates_empty(tr) for tr, ev in found)
    # Самая дорогая ошибка: остатки есть, а поднос записан «всё съедено» без ИИ.
    false_empty = [tr["tray"] for tr, ev in found if ev["is_empty"] and not plates_empty(tr)]
    ai_set = []
    for tr, ev in found:
        if ev["is_empty"]:
            continue
        name = f"tray-{tr['tray']}.jpg"
        (out / "ai-set" / name).write_bytes(jpeg(crops[ev["track_id"]], 90))
        ai_set.append({"file": name, "tray": tr["tray"], "items": tr["items"], "menu": tr.get("menu")})
    (out / "ai-set" / "truth.json").write_text(json.dumps(ai_set, ensure_ascii=False, indent=1), encoding="utf-8")

    report = {
        "trays": len(truth),
        "found": len(found),
        "missed": [tr["tray"] for tr, ev in pairs if not ev],
        "extra": len(extra),
        "empty_decision_ok": f"{right_empty}/{len(found)}",
        "false_empty": false_empty,
        "to_ai": len(ai_set),
    }
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
