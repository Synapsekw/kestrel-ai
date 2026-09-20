### Task 4: Backend environment, settings, auth and error envelope

**Files:**
- Create: `backend/pyproject.toml`, `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/app/__init__.py`, `backend/app/__main__.py`, `backend/app/config.py`, `backend/app/auth.py`, `backend/app/errors.py`, `backend/app/logging_setup.py`, `backend/app/health.py`, `backend/app/main.py`, `backend/app/api.py`, `backend/tests/conftest.py`, `backend/tests/test_health.py`, `backend/tests/test_auth.py`, `backend/tests/test_errors.py`

**Interfaces:**
- Produces: `create_app(settings: Settings | None = None) -> FastAPI`; `Settings` fields `host: str = "127.0.0.1"`, `port: int = 8765`, `token: str`, `data_dir: Path`, `log_level: str = "INFO"`, `version: str`; `require_token` dependency; `AppError(code: str, message: str, status: int = 400, details: dict | None = None)`; helpers `not_found(what, id_) -> AppError` (404) and `not_implemented(what) -> AppError` (501).
- Consumes: nothing.

- [ ] **Step 1: Create the venv with uv (Python 3.11.15, local only)**

```powershell
cd E:\Dev\Yolo\app\backend
uv venv --python 3.11.15 .venv
```

`requirements.txt` (cu130 wheels come from the PyTorch index; pins from the reference machine):

```
--extra-index-url https://download.pytorch.org/whl/cu130
fastapi==0.118.0
uvicorn[standard]==0.37.0
pydantic==2.13.5
pydantic-settings==2.11.0
sqlalchemy==2.0.43
alembic==1.16.5
httpx==0.28.1
pillow==12.3.0
ImageHash==4.3.2
numpy==2.4.6
opencv-python==5.0.0.93
torch==2.14.0+cu130
torchvision==0.29.0+cu130
ultralytics==8.4.154
sahi==0.12.6
openai==1.109.1
anthropic>=0.69,<1
keyring==25.6.0
python-multipart==0.0.20
websockets==15.0.1
```

`requirements-dev.txt`:

```
-r requirements.txt
pytest==8.4.2
pytest-asyncio==1.2.0
schemathesis==4.3.6
hypothesis==6.140.2
pyyaml==6.0.2
ruff==0.13.3
pyinstaller==6.16.0
```

If a pinned version does not resolve on the day of install, take the nearest newer patch release and record the change in `docs/progress.md`. Never change the torch, torchvision, ultralytics, opencv, imagehash, numpy or pillow pins.

Run: `uv pip install -r requirements-dev.txt`
Expected: finishes; `.\.venv\Scripts\python -c "import torch, ultralytics; print(torch.__version__, torch.cuda.is_available())"` prints `2.14.0+cu130 True`.

- [ ] **Step 2: `backend/pyproject.toml`**

```toml
[project]
name = "machinery-backend"
version = "0.1.0"
requires-python = "==3.11.*"

[tool.ruff]
line-length = 110
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
markers = ["gpu: needs an NVIDIA GPU", "live: calls a cloud provider, needs an API key in the environment"]
addopts = "-m 'not gpu and not live'"
```

- [ ] **Step 3: Write failing tests**

`tests/conftest.py`:

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

TOKEN = "test-token"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(token=TOKEN, data_dir=tmp_path / "appdata", port=0)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, headers={"Authorization": f"Bearer {TOKEN}"}) as c:
        yield c


@pytest.fixture
def anon(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    d = tmp_path / "proj"
    d.mkdir()
    return d
```

`tests/test_health.py`:

```python
def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"]
    assert isinstance(body["pid"], int)
```

`tests/test_auth.py`:

```python
def test_missing_token_is_401(anon):
    r = anon.get("/api/v1/health")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_wrong_token_is_401(anon):
    r = anon.get("/api/v1/health", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401
```

`tests/test_errors.py`:

```python
def test_404_uses_error_envelope(client):
    r = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "not_found"
    assert set(body["error"]) == {"code", "message", "details"}


def test_validation_error_uses_envelope(client):
    r = client.post("/api/v1/projects", json={"name": 5})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert "errors" in r.json()["error"]["details"]
```

- [ ] **Step 4: Run to verify failure**

Run: `.\.venv\Scripts\python -m pytest -q`
Expected: ImportError on `app.config`.

- [ ] **Step 5: Implement**

`app/config.py`:

```python
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_", extra="ignore")
    host: str = "127.0.0.1"
    port: int = 8765  # 0 = pick a free port and print it on stdout as a JSON line
    token: str  # required; the launcher generates it per run
    data_dir: Path = Path.home() / "AppData" / "Roaming" / "machinery-app"
    log_level: str = "INFO"
    version: str = "0.1.0"
```

`app/errors.py`:

```python
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


def not_found(what: str, id_: str) -> AppError:
    return AppError("not_found", f"{what} {id_} not found", 404)


def not_implemented(what: str) -> AppError:
    return AppError("not_implemented", f"{what} is not implemented yet", 501)


def envelope(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(envelope(exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = {"errors": jsonable_encoder(exc.errors())}
        return JSONResponse(envelope("validation_error", "request validation failed", details), 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {401: "unauthorized", 404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return JSONResponse(envelope(code, str(exc.detail)), exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        return JSONResponse(envelope("internal_error", f"{type(exc).__name__}: {exc}"), 500)
```

`app/auth.py`:

```python
import secrets

from fastapi import Request, WebSocket

from app.errors import AppError


def require_token(request: Request) -> None:
    header = request.headers.get("authorization", "")
    expected = request.app.state.settings.token
    if not header.startswith("Bearer ") or not secrets.compare_digest(header[7:], expected):
        raise AppError("unauthorized", "missing or invalid bearer token", 401)


def ws_token_ok(ws: WebSocket) -> bool:
    return secrets.compare_digest(ws.query_params.get("token", ""), ws.app.state.settings.token)
```

`app/logging_setup.py`: `configure_logging(data_dir: Path, level: str)` installs a `RotatingFileHandler` at `data_dir / "logs" / "backend.log"` (5 MB, 5 backups) plus a stderr handler, format `%(asctime)s %(levelname)s %(name)s: %(message)s`. It is idempotent (checks for an existing handler with the same file name before adding).

`app/health.py`:

```python
import os

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
def health(request: Request) -> dict:
    s = request.app.state.settings
    return {"status": "ok", "version": s.version, "pid": os.getpid(), "started_at": request.app.state.started_at}
```

`app/api.py`:

```python
from fastapi import APIRouter, Depends

from app.auth import require_token
from app.datasets.router import router as datasets_router
from app.health import router as health_router
from app.inference.router import router as inference_router
from app.jobs.router import router as jobs_router
from app.projects.router import router as projects_router
from app.providers.router import router as providers_router
from app.training.router import router as training_router

api_router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])
for r in (health_router, projects_router, jobs_router, datasets_router, training_router, providers_router, inference_router):
    api_router.include_router(r)
```

`app/main.py`:

```python
import asyncio
import json
import os
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI

from app.config import Settings
from app.errors import install_error_handlers
from app.logging_setup import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    configure_logging(settings.data_dir, settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from app.jobs.events import EventBus
        from app.jobs.runner import JobRunner
        from app.projects.service import ProjectRegistry

        app.state.events = EventBus()
        app.state.events.bind(asyncio.get_running_loop())
        app.state.projects = ProjectRegistry(settings.data_dir)
        app.state.jobs = JobRunner(app.state.events)
        app.state.jobs.start()
        yield
        app.state.jobs.stop()
        app.state.projects.close_all()

    app = FastAPI(
        title="machinery-backend", version=settings.version, lifespan=lifespan,
        docs_url=None, redoc_url=None, openapi_url=None,
    )
    app.state.settings = settings
    app.state.started_at = datetime.now(timezone.utc).isoformat()
    install_error_handlers(app)
    from app.api import api_router
    from app.jobs.events import events_websocket

    app.include_router(api_router)
    app.add_api_websocket_route("/api/v1/events", events_websocket)
    return app


def _free_port(host: str) -> int:
    with socket.socket() as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def main() -> None:
    import uvicorn

    settings = Settings()
    port = settings.port or _free_port(settings.host)
    print(json.dumps({"event": "starting", "port": port, "pid": os.getpid()}), flush=True)
    uvicorn.run(create_app(settings), host=settings.host, port=port, log_level=settings.log_level.lower(), ws="websockets")


if __name__ == "__main__":
    main()
```

`app/__main__.py` contains `from app.main import main` and `main()`.

The `ProjectRegistry`, `JobRunner` and `EventBus` used in lifespan are built in Tasks 5 and 6; until then create them as minimal classes with `start`, `stop`, `bind`, `close_all` no-ops so the tests in this task pass, then fill them in. The four stub routers imported by `api.py` are created in Task 7; until then create them as empty `APIRouter()` instances. The projects router is created in Task 5; for this task, create `app/projects/router.py` with an empty `APIRouter()` and mark `test_404_uses_error_envelope` and `test_validation_error_uses_envelope` with `@pytest.mark.xfail(strict=True)`, removed in Task 5.

- [ ] **Step 6: Run tests**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_health.py tests/test_auth.py tests/test_errors.py`
Expected: 3 passed, 2 xfailed.

- [ ] **Step 7: Lint and commit**

Run: `.\.venv\Scripts\ruff check . && .\.venv\Scripts\ruff format --check .`

```bash
git add backend && git commit -m "feat(backend): app shell with settings, auth and error envelope"
```

---

