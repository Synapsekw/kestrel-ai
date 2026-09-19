import { describe, it, expect } from "vitest";
import { readableLogLine } from "./logLines";

describe("readableLogLine", () => {
  it("turns the trainer's JSON progress records into sentences", () => {
    expect(readableLogLine('{"kind": "start", "epochs": 3}')).toBe("training started: 3 epochs");
    expect(
      readableLogLine(
        '{"kind": "epoch", "epoch": 2, "epochs": 3, "metrics": {"metrics/precision(B)": 0.5, "metrics/recall(B)": 0.25, "metrics/mAP50(B)": 0.612, "metrics/mAP50-95(B)": 0.4}, "loss": {"box_loss": 3.8458, "cls_loss": 16.837, "dfl_loss": 2.0518}, "elapsed_s": 3.958, "eta_s": 1.979}',
      ),
    ).toBe(
      "epoch 2/3: mAP50 61.2%, precision 50.0%, recall 25.0%, loss box 3.846 cls 16.837 dfl 2.052, about 2 s left",
    );
  });

  it("leaves ordinary lines, unknown records and broken JSON alone", () => {
    const plain = "2026-09-19 08:12:00,986 INFO training v1 on dataset v1 for 3 epochs";
    expect(readableLogLine(plain)).toBe(plain);
    expect(readableLogLine('{"kind": "other", "x": 1}')).toBe('{"kind": "other", "x": 1}');
    expect(readableLogLine('{"kind": "epoch"')).toBe('{"kind": "epoch"');
  });
});
