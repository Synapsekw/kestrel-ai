"""Camera metadata: the `image_metadata` backfill and, from unit I-BK, `ImageDetail` GET/PATCH
(image inspection spec §7.3, §9.3). I-BK moves `getImage`/`updateImage` here from
`app/datasets/router.py` and replaces the stub below."""

from fastapi import APIRouter

from app.stubs import add_stubs

router = APIRouter(prefix="/projects/{projectId}", tags=["images"])

STUBS: list[tuple[str, str, str]] = [
    ("POST", "/images/metadata-refresh", "refreshImageMetadata"),
]

add_stubs(router, STUBS)
