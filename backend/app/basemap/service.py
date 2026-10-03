"""The basemap tile cache (spec 2026-10-02-site-basemap B1, B4). A tile is fetched at most once and
kept under app-data; while the network is down, uncached tiles fail fast for `BACKOFF_S`."""

import logging
import os
from pathlib import Path
from time import monotonic

import httpx

from app.basemap.sources import SOURCES

log = logging.getLogger(__name__)

BACKOFF_S = 60.0
TIMEOUT_S = 5.0


class BasemapUnavailable(Exception):
    pass


def download(url: str, user_agent: str) -> bytes:
    """The one network call; tests replace it (ADR 2026-09-21-gotcha-contract-jobs-need-offline-seams)."""
    r = httpx.get(url, headers={"User-Agent": user_agent}, timeout=TIMEOUT_S, follow_redirects=True)
    r.raise_for_status()
    return r.content


class BasemapCache:
    def __init__(self, data_dir: Path, version: str):
        self.root = data_dir / "basemap"
        # The OSM tile usage policy asks every client to identify itself.
        self.user_agent = f"KestrelAI-desktop/{version}"
        self._failed_at: float | None = None

    def tile(self, source: str, z: int, x: int, y: int) -> tuple[bytes, str]:
        src = SOURCES[source]
        path = self.root / source / str(z) / str(x) / f"{y}.{src.ext}"
        if path.is_file():
            return path.read_bytes(), src.media_type
        if self._failed_at is not None and monotonic() - self._failed_at < BACKOFF_S:
            raise BasemapUnavailable("the basemap server was unreachable moments ago")
        try:
            body = download(src.url.format(z=z, x=x, y=y), self.user_agent)
        except (httpx.HTTPError, OSError) as e:
            self._failed_at = monotonic()
            log.info("basemap %s tile %s/%s/%s unavailable: %s", source, z, x, y, e)
            raise BasemapUnavailable(str(e)) from e
        self._failed_at = None
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{os.getpid()}.part")
        tmp.write_bytes(body)
        os.replace(tmp, path)
        return body, src.media_type
