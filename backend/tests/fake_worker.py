"""Stand-in for `app.training.worker` in the launcher tests: same file protocol, no ultralytics.

It is launched as a script (never imported) and reads its script from `<run_dir>/fake.json`:
`epoch_sleep_s`, `epochs_before_hang`, `fail` (error string), `exit_code`, `skip_done`.
"""

import json
import sys
import time
from pathlib import Path


def script(run_dir: Path) -> dict:
    path = run_dir / "fake.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_line(path: Path, event: dict) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(event) + "\n")
        fh.flush()
    print(json.dumps(event), flush=True)


def write_done(run_dir: Path, payload: dict) -> None:
    tmp = run_dir / "done.json.tmp"
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(run_dir / "done.json")


def run_train(params: dict, run_dir: Path, cfg: dict) -> dict:
    progress = run_dir / "progress.jsonl"
    epochs = int(params["epochs"])
    write_line(progress, {"kind": "start", "epochs": epochs})
    save_dir = run_dir / "train"
    (save_dir / "weights").mkdir(parents=True, exist_ok=True)
    for epoch in range(1, epochs + 1):
        time.sleep(float(cfg.get("epoch_sleep_s", 0.05)))
        write_line(
            progress,
            {
                "kind": "epoch",
                "epoch": epoch,
                "epochs": epochs,
                "metrics": {"metrics/mAP50(B)": round(0.1 * epoch, 3)},
                "loss": {"box_loss": 1.0, "cls_loss": 0.9, "dfl_loss": 0.8},
                "elapsed_s": 1.0 * epoch,
                "eta_s": 1.0 * (epochs - epoch),
            },
        )
        if cfg.get("epochs_before_hang") and epoch >= int(cfg["epochs_before_hang"]):
            time.sleep(600)  # the parent is expected to cancel and kill this process
    (save_dir / "weights" / "best.pt").write_bytes(b"\0")
    (save_dir / "results.csv").write_text("epoch,time\n1,1.0\n", encoding="utf-8")
    (save_dir / "confusion_matrix.png").write_bytes(b"\x89PNG")
    (save_dir / "BoxPR_curve.png").write_bytes(b"\x89PNG")
    (run_dir / "finished.txt").write_text("done", encoding="utf-8")
    return {
        "ok": True,
        "best": str(save_dir / "weights" / "best.pt"),
        "save_dir": str(save_dir),
        "final_metrics": {"map50": 0.5, "map50_95": 0.3, "precision": 0.6, "recall": 0.4, "per_class": []},
    }


def run_export(params: dict, run_dir: Path) -> dict:
    out = run_dir / f"exported.{params['format']}"
    out.write_bytes(b"onnx")
    return {"ok": True, "path": str(out)}


def main(argv: list[str]) -> int:
    command, params = argv[0], json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    run_dir = Path(params["run_dir"])
    run_dir.mkdir(parents=True, exist_ok=True)
    cfg = script(run_dir)
    if cfg.get("fail"):
        write_done(run_dir, {"ok": False, "error": cfg["fail"]})
        return 1
    if cfg.get("skip_done"):
        print("dying without writing done.json", file=sys.stderr)
        return int(cfg.get("exit_code", 3))
    payload = run_train(params, run_dir, cfg) if command == "train" else run_export(params, run_dir)
    write_done(run_dir, payload)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
