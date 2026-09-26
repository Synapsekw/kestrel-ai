"""The maps router's import must never take the whole backend down (final-fixes item 2).

`app/api.py` imports `app.maps.router` at module scope, and that module chain pulls in `rasterio`
at module scope too. A broken GDAL in the frozen bundle must not stop the app from starting
(AGENTS.md: "the app must start even when startup work fails") -- the freeze spike already hit this
class of failure once with a missing `rasterio.serde` hidden import. `app/api.py` guards the maps
router's import with `try/except Exception`, so a failure there should leave the rest of the API
working and simply drop the map endpoints.
"""

import sys

from app.config import Settings


def test_maps_router_import_failure_leaves_the_rest_of_the_app_working(tmp_path, monkeypatch):
    # `app.api` is only imported lazily, inside `create_app`'s body, so it must be evicted from the
    # module cache first or a second `create_app()` call would just reuse the already-built router
    # from earlier tests and never re-run the guarded import at all.
    monkeypatch.delitem(sys.modules, "app.api", raising=False)
    # Poisoning `app.maps.router` itself (rather than something deep in its rasterio-importing
    # chain) is enough: `from app.maps.router import router` raises exactly the ImportError this
    # class of failure produces, without needing to simulate a broken native dependency.
    monkeypatch.setitem(sys.modules, "app.maps.router", None)

    from app.main import create_app

    settings = Settings(token="t", data_dir=tmp_path / "appdata", port=0)
    app = create_app(settings)  # must not raise

    # `app.routes` wraps each `include_router` call in a lazily-resolved object with no usable
    # `path` on this FastAPI version, so `openapi()` (still callable directly even though the app
    # disables the `/openapi.json` route) is the stable way to read the actually-registered paths.
    paths = set(app.openapi()["paths"])
    assert "/api/v1/projects" in paths, paths
    # `/model-class-maps` is the detect router's class mapping (a library model's classes), not a map.
    assert not any("map" in p.lower() and "model-class-maps" not in p for p in paths), paths
