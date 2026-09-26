"""Stand-in for PotreeConverter.exe in the runner tests; launched as a script, never imported.

Mode from FAKE_PC_MODE: `ok` prints recorded progress lines and writes <outdir>/done.txt; `slow` is
`ok` with sleeps and writes start/end times to FAKE_PC_TIMES; `fail` prints an ERROR line and exits
123; `sleep` spawns a sleeping grandchild, writes both pids to FAKE_PC_PIDS and sleeps; `argv`
writes its argv and cwd to FAKE_PC_ARGV.
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

LINES = [
    "#threads: 24",
    "=== COUNTING",
    "[67%, 1s], [DISTRIBUTING: 100%, duration: 0s, throughput: 73MPs][RAM: 0.2GB (highest 0.7GB), CPU: 39%]",
    "sampling: 2.992121s",
    "[80%, 3s], [INDEXING: 39%, duration: 1s, throughput: 8MPs][RAM: 0.4GB (highest 1.5GB), CPU: 68%]",
    "[97%, 9s], [INDEXING: 96%, duration: 7s, throughput: 3MPs][RAM: 0.1GB (highest 1.5GB), CPU: 1%]",
    "metadata & hierarchy: 7.890049s",
]


def main() -> int:
    mode = os.environ.get("FAKE_PC_MODE", "ok")
    args = sys.argv[1:]
    out = Path(args[args.index("-o") + 1]) if "-o" in args else Path("octree")
    if mode == "argv":
        Path(os.environ["FAKE_PC_ARGV"]).write_text(json.dumps({"argv": args, "cwd": os.getcwd()}), "utf-8")
        return 0
    if mode == "fail":
        print("=== COUNTING", flush=True)
        print("ERROR(chunker_countsort_laszip.cpp:248): encountered point outside bounding box.", flush=True)
        print("PotreeConverter requires a valid bounding box to operate.", flush=True)
        return 123
    if mode == "sleep":
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        Path(os.environ["FAKE_PC_PIDS"]).write_text(json.dumps([os.getpid(), child.pid]), "utf-8")
        time.sleep(120)
        return 0
    start = time.time()
    for line in LINES:
        print(line, flush=True)
        if mode == "slow":
            time.sleep(0.1)
    out.mkdir(parents=True, exist_ok=True)
    (out / "done.txt").write_text("ok", "utf-8")
    if mode == "slow":
        with open(os.environ["FAKE_PC_TIMES"], "a", encoding="utf-8") as f:
            f.write(f"{start} {time.time()}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
