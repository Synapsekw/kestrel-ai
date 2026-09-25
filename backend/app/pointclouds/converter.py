"""Run PotreeConverter out of process (spec §6.7).

One converter at a time per process (a module lock; a second import waits, cancellably). The
converter runs in the work folder with relative ASCII arguments only, inside a Job Object that kills
it if this process dies; cancel kills its tree with taskkill /T /F. `run_converter` is the seam the
test fixture replaces (gotcha: contract jobs need offline seams).

Foundation F0 fixed the signature so the test fixture can replace it from day one
(`tests/conftest.py::app` installs `tests/pointclouds.py::fake_run_converter`, per the ADR
2026-09-21-gotcha-contract-jobs-need-offline-seams). Unit I1 builds the real runner below.

Callers resolve it at call time through the module (`converter.run_converter(...)`), never with a
module-scope `from app.pointclouds.converter import run_converter` or a default argument bound at
import: either would keep the real runner after the fixture patched the module attribute.
"""

from __future__ import annotations

import collections
import os
import re
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.jobs.cancellation import JobCancelled, JobFailure

ENCODING = "BROTLI"
LOG_LINES = 200
WAITING = "waiting for another point-cloud import"
PROGRESS_RE = re.compile(r"^\[(\d+)%, (\d+)s\], \[([A-Z]+): (\d+)%")
CREATE_NO_WINDOW = 0x08000000
TERMINATE_GRACE_S = 10
_LOCK = threading.Lock()


class ConverterStopped(JobFailure):
    """A non-zero exit; carries the converter's last lines for the job log (spec §6.7)."""

    def __init__(self, message: str, log_tail: list[str]):
        super().__init__(message)
        self.log_tail = log_tail


@dataclass(frozen=True)
class ConverterResult:
    """What a finished conversion reports. F0's dataclass, re-stated verbatim; never changed here."""

    octree_dir: Path  # holds metadata.json, hierarchy.bin and octree.bin
    log_tail: list[str]  # the converter's last output lines, at most 200
    command: list[str]  # the command line, for source.json
    seconds: float
    encoding: str = "BROTLI"  # what metadata.json must say; the offline fake reports "DEFAULT"
    version: str = "2.1.5"  # the PotreeConverter version, for source.json


def parse_progress(line: str) -> tuple[float, str] | None:
    m = PROGRESS_RE.match(line.strip())
    if not m:
        return None
    overall, _seconds, stage, pct = m.groups()
    return int(overall) / 100, f"building the 3D view copy: {stage} {int(pct)} %"


def _exe_prefix() -> list[str]:
    from app.pointclouds.converter_path import require_converter

    return [str(require_converter())]


def terminate_tree(proc: subprocess.Popen) -> None:
    """Take the converter and anything it started down; only ever our own process tree.

    Best-effort cleanup only: whatever goes wrong here must never raise and mask a caller's
    in-flight exception (e.g. the `JobCancelled` this is usually called just before re-raising).
    """
    if proc.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(  # noqa: S603, S607
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True,
                check=False,
                timeout=TERMINATE_GRACE_S,
            )
        except subprocess.TimeoutExpired:
            pass
    else:
        proc.kill()
    try:
        proc.wait(TERMINATE_GRACE_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            pass


def _last_error(lines: list[str], code: int) -> str:
    for line in reversed(lines):
        if "ERROR" in line:
            return line.strip()
    for line in reversed(lines):
        if line.strip():
            return line.strip()
    return f"exit code {code}"


def _acquire(progress: Callable[[float, str], None], check_cancelled: Callable[[], None]) -> None:
    if _LOCK.acquire(blocking=False):
        return
    progress(0.0, WAITING)
    while not _LOCK.acquire(timeout=0.25):
        check_cancelled()


def run_converter(
    input_path: Path,
    out_dir: Path,
    *,
    progress: Callable[[float, str], None],
    check_cancelled: Callable[[], None],
) -> ConverterResult:
    """Convert the LAS/LAZ at `input_path` into a Potree 2.0 octree in `out_dir`."""
    work = input_path.parent
    if out_dir.parent != work:
        raise ValueError("the converter's input and output must share the work folder")
    _acquire(progress, check_cancelled)
    try:
        return _run(work, input_path.name, out_dir.name, progress, check_cancelled)
    finally:
        _LOCK.release()


def _run(work: Path, input_name: str, out_name: str, progress, check_cancelled) -> ConverterResult:
    command = [*_exe_prefix(), input_name, "-o", out_name, "--encoding", ENCODING]
    tail: collections.deque[str] = collections.deque(maxlen=LOG_LINES)
    latest: list[tuple[float, str] | None] = [None]
    started = time.monotonic()
    proc = subprocess.Popen(  # noqa: S603 - our own converter, no shell
        command,
        cwd=work,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    job = None
    reader: threading.Thread | None = None
    try:
        if os.name == "nt":
            from app.pointclouds import winjob

            job = winjob.kill_on_close(proc)

        def pump() -> None:
            for raw in proc.stdout:
                line = raw.rstrip("\r\n")
                tail.append(line)
                parsed = parse_progress(line)
                if parsed:
                    latest[0] = parsed

        reader = threading.Thread(target=pump, name="potreeconverter-stdout", daemon=True)
        reader.start()
        reported = None
        while proc.poll() is None:
            try:
                check_cancelled()
            except JobCancelled:
                terminate_tree(proc)
                raise
            if latest[0] is not None and latest[0] != reported:
                reported = latest[0]
                progress(*reported)
            time.sleep(0.2)
        reader.join(5)
        if latest[0] is not None and latest[0] != reported:
            progress(*latest[0])
    finally:
        if proc.poll() is None:
            terminate_tree(proc)
        if reader is not None:
            reader.join(5)
        if proc.stdout is not None:
            proc.stdout.close()
        if job is not None:
            from app.pointclouds import winjob

            winjob.close(job)
    lines = list(tail)
    if proc.returncode != 0:
        raise ConverterStopped(
            f"the point-cloud converter stopped: {_last_error(lines, proc.returncode)}", lines
        )
    return ConverterResult(
        octree_dir=work / out_name,
        log_tail=lines,
        command=command,
        seconds=time.monotonic() - started,
        encoding=ENCODING,
    )
