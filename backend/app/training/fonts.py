"""Seed the font Ultralytics plots with, so a packaged app never needs the network (spec 10).

Ultralytics draws its label and result plots with `Arial.ttf` and downloads it from GitHub into
`YOLO_CONFIG_DIR` the first time a machine trains. An installed app may well be offline, and a
failed download costs a long timeout in the middle of a run, so the worker points the config dir
at the app data folder and copies a font that is already on the machine into it. Nothing is
redistributed: the candidates are the machine's own Arial and the DejaVuSans that ships with
matplotlib (an Ultralytics dependency, so it is inside the frozen bundle as well).
"""

import importlib.util
import logging
import os
import shutil
from pathlib import Path

FONT_NAME = "Arial.ttf"
log = logging.getLogger(__name__)


def font_candidates() -> list[Path]:
    """Fonts to seed from, best first."""
    candidates = [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf"]
    spec = importlib.util.find_spec("matplotlib")
    if spec and spec.origin:
        candidates.append(Path(spec.origin).parent / "mpl-data" / "fonts" / "ttf" / "DejaVuSans.ttf")
    return candidates


def ensure_font(config_dir: Path) -> Path | None:
    """Put `Arial.ttf` in `config_dir` if it is not there yet; None when no candidate exists."""
    config_dir = Path(config_dir)
    dest = config_dir / FONT_NAME
    if dest.is_file():
        return dest
    for source in font_candidates():
        if not source.is_file():
            continue
        config_dir.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(f".{os.getpid()}.tmp")
        shutil.copy2(source, tmp)
        os.replace(tmp, dest)  # atomic: a half-copied font would break every plot
        log.info("seeded %s from %s", dest, source)
        return dest
    log.warning("no font to seed %s from; ultralytics will try to download one", dest)
    return None


def _config_dir(data_dir: str | Path | None) -> Path | None:
    existing = os.environ.get("YOLO_CONFIG_DIR")
    if existing:
        return Path(existing)
    root = data_dir or os.environ.get("APP_DATA_DIR")
    return Path(root) / "ultralytics" if root else None


def configure_ultralytics(data_dir: str | Path | None = None) -> Path | None:
    """Point `YOLO_CONFIG_DIR` at app data and seed the font. Run before ultralytics is imported.

    The config dir is whatever the launcher already chose, else `<data_dir>/ultralytics`, else the
    inherited `APP_DATA_DIR`. With none of those there is nowhere sensible to write, and Ultralytics
    keeps its own default; that is logged rather than raised, because a plot font is not worth
    failing a training run over.
    """
    config_dir = _config_dir(data_dir)
    if config_dir is None:
        log.warning("no app data dir: ultralytics keeps its default config dir")
        return None
    config_dir.mkdir(parents=True, exist_ok=True)
    os.environ["YOLO_CONFIG_DIR"] = str(config_dir)
    ensure_font(config_dir)
    return config_dir
