import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def configure_logging(data_dir: Path, level: str) -> Path:
    """Rotating app log under data_dir/logs plus stderr. Idempotent per log file."""
    log_dir = data_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "backend.log"
    root = logging.getLogger()
    root.setLevel(level.upper())
    logging.getLogger("alembic").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    already = any(
        isinstance(h, RotatingFileHandler) and Path(h.baseFilename) == log_file for h in root.handlers
    )
    if not already:
        fh = RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        fh.setFormatter(logging.Formatter(FORMAT))
        root.addHandler(fh)
        if not any(isinstance(h, logging.StreamHandler) and h.stream is sys.stderr for h in root.handlers):
            sh = logging.StreamHandler(sys.stderr)
            sh.setFormatter(logging.Formatter(FORMAT))
            root.addHandler(sh)
    return log_file
