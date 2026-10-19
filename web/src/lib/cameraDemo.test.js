import { describe, expect, test } from "vitest";
import { detsAt, passedBy, summary, traysAt, trayVerdict } from "./cameraDemo";

const frames = [
  { t: 0, trays: [[1, 0, 0, 100, 100]], dets: [["plate", 10, 10, 50, 50]] },
  { t: 1, trays: [[1, 100, 0, 200, 100], [2, 0, 0, 80, 80]], dets: [] },
  { t: 2, trays: [], dets: [] }
];

describe("cameraDemo", () => {
  test("до первого кадра модели ничего не видно", () => {
    expect(traysAt(frames, -0.5)).toEqual([]);
    expect(detsAt(frames, -0.5)).toEqual([]);
  });

  test("рамка подноса едет плавно между кадрами модели", () => {
    expect(traysAt(frames, 0.5)).toEqual([{ id: 1, box: [50, 0, 150, 100] }]);
  });

  test("новый поднос появляется на своём кадре, уехавший пропадает", () => {
    expect(traysAt(frames, 1.5).map((t) => t.id)).toEqual([1, 2]);
    expect(traysAt(frames, 1.5)[0].box).toEqual([100, 0, 200, 100]);
    expect(traysAt(frames, 5)).toEqual([]);
  });

  test("посуда берётся с ближайшего прошлого кадра", () => {
    expect(detsAt(frames, 0.9)).toEqual([{ kind: "plate", box: [10, 10, 50, 50] }]);
  });

  test("проехавшие подносы и счётчики", () => {
    const events = [
      { id: 1, t: 1, empty: true },
      { id: 2, t: 2, empty: false },
      { id: 3, t: 9, empty: false }
    ];
    const passed = passedBy(events, 2);
    expect(passed.map((e) => e.id)).toEqual([2, 1]);
    expect(summary(passed)).toEqual({ trays: 2, empty: 1, ai: 1, requests: 1 });
    expect(summary([])).toEqual({ trays: 0, empty: 0, ai: 0, requests: 0 });
  });

  test("вердикт по подносу", () => {
    expect(trayVerdict({ empty: true }).title).toBe("Всё съедено");
    expect(trayVerdict({ empty: false }).title).toBe("Есть остатки");
    const ai = { model: "m", items: [{ name: "Плов", leftover_pct: 50 }, { name: "Чай", leftover_pct: 0 }] };
    expect(trayVerdict({ empty: false, ai }).title).toBe("Плов - осталось 50%, Чай - съели");
  });
});
