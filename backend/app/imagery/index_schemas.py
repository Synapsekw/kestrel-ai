"""The columnar index response (image inspection spec §7.1). `lon`/`lat` are left unset, so absent
from the JSON, unless `fields=geo`."""

from pydantic import BaseModel


class ImageIndexOut(BaseModel):
    total: int
    ids: list[str]
    sev: list[int]
    count: list[int]
    flags: list[int]
    lon: list[float | None] | None = None
    lat: list[float | None] | None = None
