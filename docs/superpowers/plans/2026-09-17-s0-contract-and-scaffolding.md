# S0: Contract and Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the API contract (`contract/openapi.yaml`), the generated TypeScript client, a mock server that serves the contract, the repo skeleton with CI and lint, a FastAPI backend shell with auth, error envelope, project store, job runner and websocket events, and a Tauri 2 shell that boots the backend sidecar and shows the React UI once health passes.

**Architecture:** Three top-level parts (`backend/`, `frontend/`, `contract/`) in one repo. The backend is a FastAPI app bound to localhost on a port chosen by the launcher, protected by a per-launch bearer token passed in the `APP_TOKEN` environment variable. The Tauri Rust layer picks a free port, generates the token, spawns the sidecar with both in its environment, and exposes them to the web view through one command. In browser-only development the UI reads `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` instead, or targets the Prism mock server.

**Tech Stack:** Python 3.11.15 (uv-managed), FastAPI, uvicorn, pydantic 2, SQLAlchemy 2, Alembic, pytest, schemathesis; Node 24, pnpm, Vite 6, React 18, TypeScript 5, Tailwind 3, react-router 6, zustand, openapi-typescript + openapi-fetch, Vitest, Playwright; Stoplight Prism (mock) and Spectral (lint); Tauri 2 with tauri-plugin-shell and tauri-plugin-dialog; Rust stable MSVC.

**Spec:** `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md` sections 2, 3, 4, 9, 10, 11, 12, 13. This plan owns S0 from section 13.1.

## Global Constraints

- Locked decisions in spec section 2 are not negotiable: Tauri 2, React 18 + TypeScript + Vite + Konva + Tailwind, Python 3.11 + FastAPI + PyInstaller sidecar, OpenAPI as source of truth with generated client and mock server, SQLite per project, keyring for secrets.
- Pins from `E:\Dev\Yolo\README.md`: Python 3.11.15, torch 2.14.0+cu130, torchvision 0.29.0+cu130, ultralytics 8.4.154, opencv-python 5.0.0.93, imagehash 4.3.2, sahi 0.12.6, numpy 2.4.6, pillow 12.3.0, openai 1.109.1, httpx 0.28.1, pydantic 2.13.5.
- Nothing installed system-wide except the Rust toolchain (rustup, stable-x86_64-pc-windows-msvc). Backend uses `backend/.venv`, frontend uses local `node_modules`. Record the Rust install in `docs/progress.md`.
- Ports 8080 and 9090 are taken by other services on the reference machine. Defaults here: backend dev 8765, mock server 4010, Vite 1420.
- Base path `/api/v1`, JSON, bearer token on every request. Error shape `{error: {code, message, details}}`. Every list endpoint paginates with `limit` and `cursor`.
- Never write a secret to a file, fixture, log or commit.
- Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`. Tests copy samples from `E:\Dev\Yolo\data\raw\ahmadia`.
- Product name: `machinery-app` identifiers; display name "Machinery Detection". Never use the Label Studio name.
- Default branch is `main`. Feature work happens on branches in worktrees under `.worktrees/` (gitignored).

## Repo layout (spec section 3)

```
app/
  .github/workflows/ci.yml
  .gitignore  .editorconfig  README.md
  backend/
    pyproject.toml  requirements.txt  requirements-dev.txt  machinery_backend.spec
    scripts/build.ps1
    app/
      __init__.py  __main__.py  main.py  config.py  auth.py  errors.py  logging_setup.py  api.py  appdata.py  health.py  pagination.py
      db/ base.py  models.py  session.py  migrations/ (alembic.ini, env.py, script.py.mako, versions/0001_initial.py)
      jobs/ runner.py  registry.py  events.py  schemas.py  router.py
      projects/ service.py  schemas.py  router.py
      datasets/ router.py        (S0: 501 stubs; S1 owns)
      training/ router.py        (S0: 501 stubs; S3 owns)
      providers/ router.py       (S0: 501 stubs; S4 owns)
      inference/ router.py       (S0: 501 stubs; S4 owns)
    tests/ conftest.py  test_health.py  test_auth.py  test_errors.py  test_db.py  test_projects.py  test_jobs.py  test_contract.py
  contract/
    openapi.yaml  package.json  .spectral.yaml  README.md
    client/ schema.d.ts (generated)  index.ts
  frontend/
    package.json  vite.config.ts  tsconfig.json  tailwind.config.ts  postcss.config.js  index.html  playwright.config.ts
    src/ main.tsx  App.tsx  routes.tsx  index.css  test-setup.ts  vite-env.d.ts
      api/ backend.ts  client.tsx  events.ts
      app/ Splash.tsx  ErrorBoundary.tsx  Shell.tsx  diagnostics.ts
      store/ jobs.ts
      screens/ ProjectsScreen.tsx  DataManagerScreen.tsx  EditorScreen.tsx  ReviewScreen.tsx  ModelsScreen.tsx  TrainScreen.tsx  QueryScreen.tsx  SettingsScreen.tsx
    e2e/ boot.spec.ts
    src-tauri/ Cargo.toml  tauri.conf.json  build.rs  src/main.rs  src/lib.rs  src/sidecar.rs  capabilities/default.json  binaries/  icons/
  scripts/ dev.ps1
  docs/ progress.md  superpowers/specs  superpowers/plans
```

## Resource list for `openapi.yaml` (spec section 9 mapped to paths)

All under `/api/v1`. `{p}` is `{projectId}`.

| Spec resource | Paths |
|---|---|
| health | `GET /health` |
| projects | `GET /projects` (recent), `POST /projects` (create), `POST /projects/open` (by folder), `GET /projects/{p}`, `PATCH /projects/{p}` (name, preannotation_model_id, import_defaults), `PUT /projects/{p}/classes`, `GET /projects/{p}/stats` |
| sources | `POST /projects/{p}/sources` (starts import job), `GET /projects/{p}/sources`, `GET /projects/{p}/sources/{sourceId}`, `GET /projects/{p}/sources/{sourceId}/stats` |
| images | `GET /projects/{p}/images` (filter, sort, limit, cursor), `GET /projects/{p}/images/{imageId}`, `GET /projects/{p}/images/{imageId}/file?max_side=`, `GET /projects/{p}/images/{imageId}/thumbnail`, `POST /projects/{p}/images/bulk-delete`, `POST /projects/{p}/images/{imageId}/preannotate` |
| boxes | `GET /projects/{p}/images/{imageId}/boxes`, `POST /projects/{p}/images/{imageId}/boxes`, `PATCH /projects/{p}/boxes/{boxId}`, `DELETE /projects/{p}/boxes/{boxId}`, `POST /projects/{p}/boxes/review` (accept or reject by ids) |
| datasets | `POST /projects/{p}/datasets` (freeze and materialise, returns dataset and job), `GET /projects/{p}/datasets`, `GET /projects/{p}/datasets/{datasetId}`, `GET /projects/{p}/datasets/{datasetId}/stats` |
| models | `GET /projects/{p}/models`, `POST /projects/{p}/models/import`, `POST /projects/{p}/models/train` (job), `GET /projects/{p}/models/{modelId}`, `POST /projects/{p}/models/{modelId}/export` (job), `DELETE /projects/{p}/models/{modelId}` |
| providers | `GET /providers`, `PATCH /providers/{provider}` (model_name, requests_per_minute, cost_per_request), `PUT /providers/{provider}/key`, `DELETE /providers/{provider}/key`, `POST /providers/{provider}/test` |
| query-runs | `POST /projects/{p}/query-runs/estimate`, `POST /projects/{p}/query-runs` (job), `GET /projects/{p}/query-runs`, `GET /projects/{p}/query-runs/{runId}`, `POST /projects/{p}/query-runs/{runId}/promote` |
| jobs | `GET /projects/{p}/jobs`, `GET /projects/{p}/jobs/{jobId}`, `POST /projects/{p}/jobs/{jobId}/cancel`, `GET /projects/{p}/jobs/{jobId}/log?tail=` |
| ws /events | `GET /api/v1/events?token=` websocket, messages `{type, project_id, job_id, progress, message, payload}` (documented in the spec under `x-websocket`) |

Additions beyond the literal section 9 list, each justified by another spec section: `GET /projects` (section 6 screen 1 "open recent"), `PATCH /projects/{p}` (section 6 screen 5 project settings), `POST .../preannotate` (section 7 pre-annotation), `POST .../models/train` (section 7 training job), `POST .../query-runs/estimate` (section 8 cost estimate), `POST .../images/bulk-delete` (section 6 bulk delete), `GET /projects/{p}/stats` (section 5 statistics endpoint). Jobs are scoped under a project because the Job table lives in the project database (section 4).

Every operation declares a `default` response with the `Error` schema. Operations owned by S1, S3 and S4 are implemented in S0 as stubs returning `501 not_implemented` in the error envelope, so the contract conformance test passes on the shell and each sub-project replaces its stubs.

---

### Task 1: Repository skeleton and first commit

**Files:**
- Create: `.gitignore`, `.editorconfig`, `README.md`, `docs/progress.md`
- Existing: `docs/superpowers/specs/...`, `KICKOFF_PROMPT.md`

**Interfaces:**
- Produces: branch `main` with the spec committed; ignored paths `backend/.venv`, `node_modules`, `.worktrees`, `dist`, `target`, `*.pt`, `*.db`, `.env`.

- [ ] **Step 1: Rename the unborn branch to main and write ignore rules**

```bash
cd /e/Dev/Yolo/app && git branch -m main
```

`.gitignore`:

```
# python
backend/.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/
.hypothesis/
backend/build/
backend/dist/
# node
node_modules/
frontend/dist/
frontend/test-results/
frontend/playwright-report/
# rust / tauri
frontend/src-tauri/target/
frontend/src-tauri/gen/
frontend/src-tauri/binaries/*
!frontend/src-tauri/binaries/.gitkeep
# worktrees and local data
.worktrees/
*.db
*.db-journal
*.db-wal
*.db-shm
*.pt
*.onnx
*.engine
.env
.env.*
# os
Thumbs.db
.DS_Store
```

`.editorconfig`:

```
root = true
[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
[*.py]
indent_size = 4
[*.rs]
indent_size = 4
```

- [ ] **Step 2: Write the README stub**

```markdown
# Machinery Detection (working name `machinery-app`)

Windows desktop app for aerial construction-machinery detection: dataset preparation,
bounding-box annotation, YOLO training with a model registry, and inference with local
models or OpenAI / Anthropic vision models.

Design: `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md`.
Progress and resume instructions: `docs/progress.md`.

Sections "Build", "Run in development" and "Run the tests" are filled in by S0 Task 12.
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: repo skeleton, spec and kickoff prompt"
```

---

### Task 2: OpenAPI contract (goal owner writes this)

**Files:**
- Create: `contract/openapi.yaml`, `contract/.spectral.yaml`, `contract/package.json`, `contract/README.md`

**Interfaces:**
- Produces: the complete contract per the resource table above. Schemas: `Error`, `Health`, `ClassDef`, `ClassDefInput`, `Project`, `ProjectCreate`, `ProjectOpen`, `ProjectUpdate`, `ProjectPage`, `ProjectStats`, `Source`, `SourceCreate`, `SourceWithJob`, `SourcePage`, `SourceStats`, `Image`, `ImagePage`, `BulkDelete`, `Box`, `BoxCreate`, `BoxUpdate`, `BoxList`, `BoxReview`, `BoxReviewResult`, `Dataset`, `DatasetCreate`, `DatasetWithJob`, `DatasetPage`, `DatasetStats`, `Model`, `ModelImport`, `ModelPage`, `TrainRequest`, `ExportRequest`, `Provider`, `ProviderList`, `ProviderUpdate`, `ProviderKey`, `ProviderTestResult`, `QueryRun`, `QueryRunCreate`, `QueryRunWithJob`, `QueryRunPage`, `PromoteRequest`, `CostEstimate`, `Job`, `JobPage`, `JobLog`, `Event`.
- Conventions: ids are UUID strings; timestamps are RFC 3339 strings; pixel boxes are `x, y, w, h` numbers; enums exactly as spec section 4 (`review_state`: unreviewed | accepted | rejected | edited; `provenance.kind`: person | local_model | cloud_provider; job `state`: queued | running | succeeded | failed | cancelled; job `type`: import | dataset | train | infer | export).
- Security scheme `bearerAuth` (http bearer) applied globally through top-level `security: [{bearerAuth: []}]`.
- Every list endpoint takes `limit` (default 100, max 1000) and `cursor` query parameters and returns `{items, next_cursor}` with `next_cursor` nullable.
- Examples on every schema so Prism returns deterministic data. The `Project` example is named "Ahmadia" (the frontend e2e test looks for it).

- [ ] **Step 1: Write `contract/openapi.yaml`** with the resource table above, every schema with `example` values, and `x-websocket` documenting `/api/v1/events`.

- [ ] **Step 2: Contract tooling**

`contract/package.json`:

```json
{
  "name": "@machinery-app/contract",
  "private": true,
  "scripts": {
    "lint": "spectral lint openapi.yaml",
    "mock": "prism mock openapi.yaml --host 127.0.0.1 --port 4010",
    "generate": "openapi-typescript openapi.yaml -o client/schema.d.ts",
    "check": "pnpm lint && pnpm generate && git diff --exit-code -- client/schema.d.ts"
  },
  "devDependencies": {
    "@stoplight/prism-cli": "^5.14.2",
    "@stoplight/spectral-cli": "^6.15.0",
    "openapi-typescript": "^7.9.1"
  }
}
```

`.spectral.yaml`:

```yaml
extends: ["spectral:oas"]
rules:
  operation-tags: off
  info-contact: off
  oas3-unused-component: error
  operation-operationId: error
```

- [ ] **Step 3: Install and lint**

Run: `cd contract && pnpm install && pnpm lint`
Expected: `No results with a severity of 'error' found!` (warnings acceptable).

- [ ] **Step 4: Start the mock server and curl health**

Run: `pnpm mock` in one shell, then `curl -s -H "Authorization: Bearer x" http://127.0.0.1:4010/api/v1/health`
Expected: the `Health` example JSON. Without the header expect HTTP 401 from Prism.

- [ ] **Step 5: Commit**

```bash
git add contract && git commit -m "feat(contract): openapi v1 with mock and lint tooling"
```

---

### Task 3: Generated TypeScript client

**Files:**
- Create: `contract/client/schema.d.ts` (generated, committed), `contract/client/index.ts`

**Interfaces:**
- Produces: `createApiClient({baseUrl, token}): ApiClient` where `ApiClient = ReturnType<typeof createClient<paths>>` from `openapi-fetch`, and exported types `components`, `paths`, and aliases `Project = components["schemas"]["Project"]` for every schema. Also `eventsUrl(baseUrl, token)`.

- [ ] **Step 1: Generate**

Run: `cd contract && pnpm generate`
Expected: `client/schema.d.ts` written with `export interface paths {...}`.

- [ ] **Step 2: Write `contract/client/index.ts`**

```ts
import createClient, { type Middleware } from "openapi-fetch";
import type { paths, components } from "./schema";

export type { paths, components };
export type Schemas = components["schemas"];
export type Health = Schemas["Health"];
export type Project = Schemas["Project"];
export type ClassDef = Schemas["ClassDef"];
export type Job = Schemas["Job"];
export type Image = Schemas["Image"];
export type Box = Schemas["Box"];
export type Dataset = Schemas["Dataset"];
export type Model = Schemas["Model"];
export type Provider = Schemas["Provider"];
export type QueryRun = Schemas["QueryRun"];
export type ApiError = Schemas["Error"];
export type AppEvent = Schemas["Event"];

export interface ApiClientOptions {
  baseUrl: string; // e.g. http://127.0.0.1:8765
  token: string;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: `${opts.baseUrl.replace(/\/$/, "")}/api/v1`,
    fetch: opts.fetch,
  });
  const auth: Middleware = {
    onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${opts.token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function eventsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/events?token=${encodeURIComponent(token)}`;
}
```

`openapi-fetch` is a dependency of `frontend/package.json` (Task 8); the contract package only generates types.

- [ ] **Step 3: Commit**

```bash
git add contract/client && git commit -m "feat(contract): generated typescript client"
```

---

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

### Task 5: Database models, migrations and project store

**Files:**
- Create: `backend/app/db/base.py`, `backend/app/db/models.py`, `backend/app/db/session.py`, `backend/app/db/migrations/alembic.ini`, `backend/app/db/migrations/env.py`, `backend/app/db/migrations/script.py.mako`, `backend/app/db/migrations/versions/0001_initial.py`, `backend/app/appdata.py`, `backend/app/projects/service.py`, `backend/app/projects/schemas.py`, `backend/app/projects/router.py`, `backend/tests/test_projects.py`, `backend/tests/test_db.py`

**Interfaces:**
- Produces: SQLAlchemy models `Project, Source, Image, Box, Dataset, DatasetImage, Model, Job, QueryRun` with the columns of spec section 4; `ProjectRegistry(data_dir)` with `create(name, folder, classes) -> ProjectHandle`, `open(folder) -> ProjectHandle`, `get(project_id) -> ProjectHandle` (raises `not_found`), `recent() -> list[dict]`, `close_all()`; `ProjectHandle` with `id: str`, `folder: Path`, `engine`, `session() -> contextmanager[Session]`, and folder helpers `images_dir`, `labels_dir`, `datasets_dir`, `runs_dir`, `models_dir`, `thumbs_dir`; FastAPI dependency `get_project(projectId: str, request: Request) -> ProjectHandle` in `app/projects/service.py`.
- Consumes: `AppError`, `Settings`.

- [ ] **Step 1: Write failing tests**

`tests/test_db.py`:

```python
from sqlalchemy import inspect

from app.db.session import open_project_db


def test_migrations_create_schema(project_dir):
    engine = open_project_db(project_dir)
    names = set(inspect(engine).get_table_names())
    expected = {"project", "source", "image", "box", "dataset", "dataset_image", "model", "job", "query_run"}
    assert expected <= names
```

`tests/test_projects.py`:

```python
CLASSES = [
    {"name": "excavator", "colour": "#ff0000", "hotkey": "1"},
    {"name": "dump_truck", "colour": "#00ff00", "hotkey": "2"},
]


def _create(client, folder, name="Ahmadia"):
    r = client.post("/api/v1/projects", json={"name": name, "folder": str(folder), "classes": CLASSES})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_project_makes_folder_layout(client, project_dir):
    p = _create(client, project_dir)
    assert p["name"] == "Ahmadia" and len(p["classes"]) == 2 and p["classes"][0]["order"] == 0
    assert p["folder"] == str(project_dir)
    for sub in ("images", "labels", "datasets", "runs", "models", "cache/thumbs"):
        assert (project_dir / sub).is_dir()
    assert (project_dir / "project.db").exists()


def test_create_in_folder_with_existing_project_is_409(client, project_dir):
    _create(client, project_dir)
    r = client.post("/api/v1/projects", json={"name": "B", "folder": str(project_dir), "classes": []})
    assert r.status_code == 409


def test_open_existing_project_returns_same_id(client, project_dir):
    created = _create(client, project_dir, "A")
    opened = client.post("/api/v1/projects/open", json={"folder": str(project_dir)}).json()
    assert opened["id"] == created["id"]
    assert client.get(f"/api/v1/projects/{created['id']}").json()["name"] == "A"


def test_open_missing_folder_is_404(client, tmp_path):
    r = client.post("/api/v1/projects/open", json={"folder": str(tmp_path / "nope")})
    assert r.status_code == 404


def test_recent_projects_listed(client, project_dir):
    _create(client, project_dir, "A")
    r = client.get("/api/v1/projects")
    assert [p["name"] for p in r.json()["items"]] == ["A"]
    assert r.json()["next_cursor"] is None


def test_update_classes_reorders_and_keeps_ids(client, project_dir):
    p = _create(client, project_dir, "A")
    new = [dict(p["classes"][1], hotkey="9"), p["classes"][0]]
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=new)
    assert r.status_code == 200
    assert [c["name"] for c in r.json()["classes"]] == ["dump_truck", "excavator"]
    assert r.json()["classes"][0]["id"] == p["classes"][1]["id"]
    assert r.json()["classes"][0]["hotkey"] == "9"


def test_duplicate_class_name_is_422(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.put(f"/api/v1/projects/{p['id']}/classes", json=[CLASSES[0], CLASSES[0]])
    assert r.status_code == 422


def test_patch_project_name_and_import_defaults(client, project_dir):
    p = _create(client, project_dir, "A")
    r = client.patch(f"/api/v1/projects/{p['id']}", json={"name": "B", "import_defaults": {"max_side": 3000}})
    assert r.status_code == 200
    assert r.json()["name"] == "B" and r.json()["import_defaults"]["max_side"] == 3000
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_db.py tests/test_projects.py`
Expected: ImportError.

- [ ] **Step 3: Implement models**

`app/db/base.py`:

```python
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
```

`app/db/models.py`: every table from spec section 4 as `mapped_column`s. Write all columns out; this is the exhaustive list.

```python
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_id, utcnow


class Project(Base):
    __tablename__ = "project"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    classes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, colour, hotkey, order}]
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    preannotation_model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    import_defaults: Mapped[dict] = mapped_column(JSON, default=dict)  # {max_side, quality, dedupe_threshold, group_regex}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Source(Base):
    __tablename__ = "source"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    folder: Mapped[str] = mapped_column(String)
    site: Mapped[str] = mapped_column(String)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)  # {max_side, quality, dedupe_threshold, group_regex}
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Image(Base):
    __tablename__ = "image"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    path: Mapped[str] = mapped_column(String)  # relative to the project folder, forward slashes
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    source_id: Mapped[str] = mapped_column(String(36), ForeignKey("source.id"))
    capture_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    alt: Mapped[float | None] = mapped_column(Float, nullable=True)
    phash: Mapped[str | None] = mapped_column(String(16), nullable=True)
    group_key: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_image_source", "source_id"), Index("ix_image_group", "group_key"), Index("ix_image_path", "path", unique=True))


class Box(Base):
    __tablename__ = "box"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id", ondelete="CASCADE"))
    class_id: Mapped[str] = mapped_column(String(36))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    w: Mapped[float] = mapped_column(Float)
    h: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    provenance_kind: Mapped[str] = mapped_column(String)  # person | local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    review_state: Mapped[str] = mapped_column(String, default="unreviewed")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_box_image", "image_id"), Index("ix_box_query_run", "query_run_id"), Index("ix_box_review", "review_state"))


class Dataset(Base):
    __tablename__ = "dataset"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    classes: Mapped[list] = mapped_column(JSON, default=list)
    split_method: Mapped[str] = mapped_column(String)  # by_group | by_tile | random
    split_params: Mapped[dict] = mapped_column(JSON, default=dict)  # {val_fraction, seed}
    path: Mapped[str] = mapped_column(String)  # relative: datasets/<name>
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DatasetImage(Base):
    __tablename__ = "dataset_image"
    dataset_id: Mapped[str] = mapped_column(String(36), ForeignKey("dataset.id", ondelete="CASCADE"), primary_key=True)
    image_id: Mapped[str] = mapped_column(String(36), ForeignKey("image.id"), primary_key=True)
    split: Mapped[str] = mapped_column(String)  # train | val
    boxes: Mapped[list] = mapped_column(JSON, default=list)  # frozen [{class_id, x, y, w, h}]


class Model(Base):
    __tablename__ = "model"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # imported | trained
    weights_path: Mapped[str] = mapped_column(String)  # relative to project folder
    base_weights: Mapped[str | None] = mapped_column(String, nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    hyperparameters: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    class_aliases: Mapped[dict] = mapped_column(JSON, default=dict)  # {"truck": "dump_truck"}
    exports: Mapped[dict] = mapped_column(JSON, default=dict)  # {"onnx": "models/x.onnx"}
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "job"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    type: Mapped[str] = mapped_column(String)  # import | dataset | train | infer | export
    state: Mapped[str] = mapped_column(String, default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(String, default="")
    log_path: Mapped[str] = mapped_column(String)  # relative: runs/<job_id>/job.log
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (Index("ix_job_state", "state"), Index("ix_job_created", "created_at"))


class QueryRun(Base):
    __tablename__ = "query_run"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)  # local_model | cloud_provider
    model_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_name: Mapped[str | None] = mapped_column(String, nullable=True)
    query: Mapped[str] = mapped_column(String, default="")
    image_ids: Mapped[list] = mapped_column(JSON, default=list)
    tiling: Mapped[dict] = mapped_column(JSON, default=dict)  # {tile_size, overlap, nms_iou}
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
```

`app/db/session.py`:

```python
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

MIGRATIONS = Path(__file__).parent / "migrations"


def open_project_db(folder: Path):
    url = f"sqlite:///{(folder / 'project.db').as_posix()}"
    engine = create_engine(url, future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    return engine


def make_session_factory(engine):
    return sessionmaker(engine, class_=Session, expire_on_commit=False, future=True)
```

`migrations/env.py` uses `target_metadata = Base.metadata` and `render_as_batch=True` (SQLite), `configure_logging` disabled (no `fileConfig` call). `versions/0001_initial.py` is produced with `alembic revision --autogenerate -m initial` against a temporary SQLite file, then reviewed and committed. `alembic.ini` contains only `[alembic]` with `script_location = .`. `env.py` must import `app.db.models` so metadata is populated; add the backend root to `sys.path` at the top of `env.py` (`sys.path.insert(0, str(Path(__file__).resolve().parents[3]))`) so it also works when frozen.

- [ ] **Step 4: Implement the project registry and router**

`app/appdata.py`:

```python
import json
from datetime import datetime, timezone
from pathlib import Path


class AppData:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._recent = self.data_dir / "recent_projects.json"
        self._settings = self.data_dir / "settings.json"

    def recent(self) -> list[dict]:
        if not self._recent.exists():
            return []
        return json.loads(self._recent.read_text("utf-8"))

    def remember(self, project_id: str, name: str, folder: str) -> None:
        items = [r for r in self.recent() if r["folder"].lower() != folder.lower()]
        items.insert(0, {"id": project_id, "name": name, "folder": folder,
                         "last_opened_at": datetime.now(timezone.utc).isoformat()})
        self._recent.write_text(json.dumps(items[:20], indent=2), "utf-8")

    def read_settings(self) -> dict:
        return json.loads(self._settings.read_text("utf-8")) if self._settings.exists() else {}

    def write_settings(self, values: dict) -> None:
        self._settings.write_text(json.dumps(values, indent=2), "utf-8")
```

`app/projects/service.py`:

```python
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import new_id
from app.db.models import Project
from app.db.session import make_session_factory, open_project_db
from app.errors import AppError, not_found

SUBDIRS = ("images", "labels", "datasets", "runs", "models", "cache/thumbs")


class ProjectHandle:
    def __init__(self, id: str, folder: Path, engine):
        self.id, self.folder, self.engine = id, folder, engine
        self._factory = make_session_factory(engine)

    images_dir = property(lambda s: s.folder / "images")
    labels_dir = property(lambda s: s.folder / "labels")
    datasets_dir = property(lambda s: s.folder / "datasets")
    runs_dir = property(lambda s: s.folder / "runs")
    models_dir = property(lambda s: s.folder / "models")
    thumbs_dir = property(lambda s: s.folder / "cache" / "thumbs")

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    def row(self, s: Session) -> Project:
        return s.execute(select(Project)).scalar_one()


def normalise_classes(classes: list[dict], existing: list[dict] | None = None) -> list[dict]:
    out, names, keys = [], set(), set()
    for i, c in enumerate(classes):
        name = c["name"].strip()
        if not name or name in names:
            raise AppError("validation_error", f"duplicate or empty class name {name!r}", 422)
        hotkey = c.get("hotkey") or None
        if hotkey and hotkey in keys:
            raise AppError("validation_error", f"duplicate hotkey {hotkey!r}", 422)
        names.add(name)
        if hotkey:
            keys.add(hotkey)
        out.append({"id": c.get("id") or new_id(), "name": name, "colour": c.get("colour") or "#4f46e5",
                    "hotkey": hotkey, "order": i})
    return out


class ProjectRegistry:
    def __init__(self, data_dir: Path):
        self.appdata = AppData(data_dir)
        self._handles: dict[str, ProjectHandle] = {}

    def create(self, name: str, folder: Path, classes: list[dict]) -> ProjectHandle:
        if (folder / "project.db").exists():
            raise AppError("already_exists", f"{folder} already contains a project", 409)
        for sub in SUBDIRS:
            (folder / sub).mkdir(parents=True, exist_ok=True)
        engine = open_project_db(folder)
        row = Project(name=name, classes=normalise_classes(classes))
        with make_session_factory(engine)() as s:
            s.add(row)
            s.commit()
            pid = row.id
        return self._cache(pid, folder, engine, name)

    def open(self, folder: Path) -> ProjectHandle:
        if not (folder / "project.db").exists():
            raise not_found("project folder", str(folder))
        for h in self._handles.values():
            if h.folder == folder:
                return h
        engine = open_project_db(folder)
        with make_session_factory(engine)() as s:
            row = s.execute(select(Project)).scalar_one()
            pid, name = row.id, row.name
        return self._cache(pid, folder, engine, name)

    def _cache(self, pid, folder, engine, name) -> ProjectHandle:
        h = ProjectHandle(pid, folder, engine)
        self._handles[pid] = h
        self.appdata.remember(pid, name, str(folder))
        return h

    def get(self, project_id: str) -> ProjectHandle:
        if project_id in self._handles:
            return self._handles[project_id]
        for r in self.appdata.recent():
            if r["id"] == project_id and (Path(r["folder"]) / "project.db").exists():
                return self.open(Path(r["folder"]))
        raise not_found("project", project_id)

    def recent(self) -> list[dict]:
        return self.appdata.recent()

    def close_all(self) -> None:
        for h in self._handles.values():
            h.engine.dispose()
        self._handles.clear()


def get_project(projectId: str, request: Request) -> ProjectHandle:  # noqa: N803 (path param name from the contract)
    return request.app.state.projects.get(projectId)
```

`PUT /classes` validation beyond `normalise_classes`: a class present before and absent after the update that still has boxes is refused with `AppError("class_in_use", "class <name> still has <n> boxes; reassign or delete them first", 409, {"class_id": ..., "box_count": n})` (spec section 6, class changes never delete boxes).

`app/projects/schemas.py`: pydantic models `ClassDefInput` (`id: str | None`, `name: str`, `colour: str`, `hotkey: str | None`), `ClassDef` (adds `order: int`, `id: str`), `ProjectCreate` (`name`, `folder`, `classes: list[ClassDefInput]`), `ProjectOpen` (`folder`), `ProjectUpdate` (`name`, `preannotation_model_id`, `import_defaults`, all optional), `ProjectOut` (`id, name, folder, classes, preannotation_model_id, import_defaults, schema_version, created_at`) with `ProjectOut.from_row(row, folder)`; `ProjectStats` matching the contract (zeros in S0).

`app/projects/router.py` mounts `GET /projects` (returns `{items: recent, next_cursor: null}` where each item is loaded through `open` to produce a full `Project`; folders that no longer exist are skipped), `POST /projects` (201), `POST /projects/open`, `GET /projects/{projectId}`, `PATCH /projects/{projectId}`, `PUT /projects/{projectId}/classes`, `GET /projects/{projectId}/stats` (S0: returns zeros in the `ProjectStats` shape; S1 fills it).

- [ ] **Step 5: Run the tests**

Run: `.\.venv\Scripts\python -m pytest -q`
Expected: all pass; remove the `xfail` marks from `test_errors.py`.

- [ ] **Step 6: Commit**

```bash
git add backend && git commit -m "feat(backend): project store, sqlite models and alembic migration"
```

---

### Task 6: Job runner, jobs endpoints and websocket events

**Files:**
- Create: `backend/app/jobs/runner.py`, `backend/app/jobs/registry.py`, `backend/app/jobs/events.py`, `backend/app/jobs/schemas.py`, `backend/app/jobs/router.py`, `backend/app/pagination.py`, `backend/tests/test_jobs.py`

**Interfaces:**
- Produces:
  - `register_job_type(name: str)` decorator in `app/jobs/registry.py`; `get_job_type(name) -> Callable`. A job function has signature `fn(ctx: JobContext) -> dict | None` and runs on a worker thread.
  - `JobContext` with `project: ProjectHandle`, `job_id: str`, `params: dict`, `log: logging.Logger` (writes to the job log file), `progress(fraction: float, message: str = "")`, `cancelled: threading.Event`, `check_cancelled()` (raises `JobCancelled`), `publish(type: str, payload: dict)` for domain events such as `images.changed`.
  - `JobRunner(events: EventBus)` with `submit(project: ProjectHandle, type: str, params: dict) -> Job` (creates the row queued, log path `runs/<job_id>/job.log`, schedules on a thread pool of 2 workers), `cancel(project, job_id) -> Job`, `start()`, `stop()`.
  - `EventBus.publish(event: dict)` (thread-safe) and `EventBus.subscribe() -> asyncio.Queue`; event dict `{type: "job.progress"|"job.state"|"boxes.changed"|"images.changed", project_id, job_id, progress, message, payload}`.
  - `encode_cursor(**kv) -> str` and `decode_cursor(s) -> dict` in `app/pagination.py` (base64 JSON), plus `clamp_limit(limit) -> int` (1..1000, default 100).
- Consumes: `ProjectHandle`, `Job` model.

- [ ] **Step 1: Write failing tests**

`tests/test_jobs.py`:

```python
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from app.jobs.registry import register_job_type


@register_job_type("test_sleep")
def _sleep_job(ctx):
    for i in range(5):
        ctx.check_cancelled()
        ctx.progress(i / 5, f"step {i}")
        ctx.log.info("step %d", i)
        time.sleep(0.05)
    return {"steps": 5}


@register_job_type("test_fail")
def _fail_job(ctx):
    raise RuntimeError("boom")


def _project(client, project_dir):
    return client.post("/api/v1/projects", json={"name": "A", "folder": str(project_dir), "classes": []}).json()["id"]


def _wait(client, pid, jid, states=("succeeded", "failed", "cancelled"), timeout=5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = client.get(f"/api/v1/projects/{pid}/jobs/{jid}").json()
        if j["state"] in states:
            return j
        time.sleep(0.05)
    raise AssertionError("timeout waiting for job")


def test_job_runs_to_success_with_progress_and_log(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "succeeded" and j["progress"] == 1.0 and j["result"] == {"steps": 5}
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log", params={"tail": 50}).json()
    assert any("step 4" in line for line in log["lines"])


def test_failed_job_records_error(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_fail", {})
    j = _wait(client, pid, job.id)
    assert j["state"] == "failed" and "boom" in j["error"]
    log = client.get(f"/api/v1/projects/{pid}/jobs/{job.id}/log").json()
    assert any("Traceback" in line for line in log["lines"])


def test_cancel_job(client, project_dir, app):
    pid = _project(client, project_dir)
    job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    r = client.post(f"/api/v1/projects/{pid}/jobs/{job.id}/cancel")
    assert r.status_code == 200
    assert _wait(client, pid, job.id)["state"] == "cancelled"


def test_jobs_list_paginates(client, project_dir, app):
    pid = _project(client, project_dir)
    for _ in range(3):
        app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
    page = client.get(f"/api/v1/projects/{pid}/jobs", params={"limit": 2}).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    page2 = client.get(f"/api/v1/projects/{pid}/jobs", params={"limit": 2, "cursor": page["next_cursor"]}).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None


def test_unknown_job_type_is_422(client, project_dir, app):
    pid = _project(client, project_dir)
    from app.errors import AppError
    with pytest.raises(AppError):
        app.state.jobs.submit(app.state.projects.get(pid), "nope", {})


def test_websocket_receives_job_events(client, project_dir, app):
    pid = _project(client, project_dir)
    with client.websocket_connect("/api/v1/events?token=test-token") as ws:
        job = app.state.jobs.submit(app.state.projects.get(pid), "test_sleep", {})
        seen = set()
        for _ in range(40):
            ev = ws.receive_json()
            if ev["job_id"] != job.id:
                continue
            seen.add(ev["type"])
            if ev["type"] == "job.state" and ev["payload"]["state"] == "succeeded":
                break
        assert {"job.progress", "job.state"} <= seen


def test_websocket_rejects_bad_token(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/events?token=wrong"):
            pass
```

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_jobs.py`
Expected: ImportError.

- [ ] **Step 3: Implement**

`app/jobs/events.py`:

```python
import asyncio

from fastapi import WebSocket


class EventBus:
    def __init__(self):
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: dict) -> None:  # safe to call from worker threads
        if self._loop is None or self._loop.is_closed():
            return
        self._loop.call_soon_threadsafe(self._fanout, event)

    def _fanout(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass


async def events_websocket(ws: WebSocket) -> None:
    from app.auth import ws_token_ok

    if not ws_token_ok(ws):
        await ws.close(code=4401)
        return
    await ws.accept()
    bus: EventBus = ws.app.state.events
    q = bus.subscribe()
    try:
        while True:
            ev = await q.get()
            await ws.send_json(ev)
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
```

`app/jobs/registry.py`:

```python
from collections.abc import Callable

from app.errors import AppError

_TYPES: dict[str, Callable] = {}


def register_job_type(name: str):
    def deco(fn: Callable):
        _TYPES[name] = fn
        return fn
    return deco


def get_job_type(name: str) -> Callable:
    try:
        return _TYPES[name]
    except KeyError:
        raise AppError("validation_error", f"unknown job type {name!r}", 422) from None
```

`app/jobs/runner.py`:

```python
import logging
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select

from app.db.models import Job
from app.errors import not_found
from app.jobs.events import EventBus
from app.jobs.registry import get_job_type
from app.projects.service import ProjectHandle


class JobCancelled(Exception):
    pass


class JobContext:
    def __init__(self, runner: "JobRunner", project: ProjectHandle, job_id: str, params: dict, log: logging.Logger):
        self.runner, self.project, self.job_id, self.params, self.log = runner, project, job_id, params, log
        self.cancelled = threading.Event()
        self._last_db_write = 0.0

    def check_cancelled(self) -> None:
        if self.cancelled.is_set():
            raise JobCancelled()

    def progress(self, fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, float(fraction)))
        now = time.monotonic()
        if now - self._last_db_write >= 0.25:
            self._last_db_write = now
            self.runner._update(self.project, self.job_id, progress=fraction, message=message)
        self.runner.events.publish({"type": "job.progress", "project_id": self.project.id, "job_id": self.job_id,
                                    "progress": fraction, "message": message, "payload": {}})

    def publish(self, type: str, payload: dict) -> None:
        self.runner.events.publish({"type": type, "project_id": self.project.id, "job_id": self.job_id,
                                    "progress": None, "message": "", "payload": payload})


class JobRunner:
    def __init__(self, events: EventBus, workers: int = 2):
        self.events = events
        self._pool: ThreadPoolExecutor | None = None
        self._contexts: dict[str, JobContext] = {}
        self._workers = workers

    def start(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=self._workers, thread_name_prefix="job")

    def stop(self) -> None:
        for ctx in self._contexts.values():
            ctx.cancelled.set()
        if self._pool:
            self._pool.shutdown(wait=False, cancel_futures=True)

    def submit(self, project: ProjectHandle, type: str, params: dict) -> Job:
        fn = get_job_type(type)
        with project.session() as s:
            job = Job(type=type, params=params, log_path="")
            s.add(job)
            s.flush()
            job.log_path = f"runs/{job.id}/job.log"
            s.flush()
            s.expunge(job)
        log_dir = project.runs_dir / job.id
        log_dir.mkdir(parents=True, exist_ok=True)
        logger = logging.getLogger(f"job.{job.id}")
        logger.setLevel(logging.INFO)
        logger.propagate = False
        handler = logging.FileHandler(log_dir / "job.log", encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        logger.addHandler(handler)
        ctx = JobContext(self, project, job.id, params, logger)
        self._contexts[job.id] = ctx
        self._pool.submit(self._run, ctx, fn, handler)
        return job

    def cancel(self, project: ProjectHandle, job_id: str) -> Job:
        ctx = self._contexts.get(job_id)
        if ctx is None:
            job = self.get(project, job_id)
            if job.state == "queued":
                return self._update(project, job_id, state="cancelled", finished_at=datetime.now(timezone.utc))
            return job
        ctx.cancelled.set()
        return self.get(project, job_id)

    def get(self, project: ProjectHandle, job_id: str) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            if job is None:
                raise not_found("job", job_id)
            s.expunge(job)
            return job

    def _update(self, project: ProjectHandle, job_id: str, **fields) -> Job:
        with project.session() as s:
            job = s.get(Job, job_id)
            for k, v in fields.items():
                setattr(job, k, v)
            s.flush()
            s.expunge(job)
        if "state" in fields:
            self.events.publish({"type": "job.state", "project_id": project.id, "job_id": job_id,
                                 "progress": job.progress, "message": job.message,
                                 "payload": {"state": job.state, "result": job.result, "error": job.error}})
        return job

    def _run(self, ctx: JobContext, fn, handler: logging.Handler) -> None:
        try:
            if ctx.cancelled.is_set():
                raise JobCancelled()
            self._update(ctx.project, ctx.job_id, state="running", started_at=datetime.now(timezone.utc))
            ctx.log.info("job %s started with %s", ctx.job_id, ctx.params)
            result = fn(ctx)
            self._update(ctx.project, ctx.job_id, state="succeeded", progress=1.0, result=result,
                         finished_at=datetime.now(timezone.utc))
            ctx.log.info("job succeeded")
        except JobCancelled:
            self._update(ctx.project, ctx.job_id, state="cancelled", finished_at=datetime.now(timezone.utc))
            ctx.log.info("job cancelled")
        except Exception as e:
            ctx.log.error("job failed\n%s", traceback.format_exc())
            self._update(ctx.project, ctx.job_id, state="failed", error=f"{type(e).__name__}: {e}",
                         finished_at=datetime.now(timezone.utc))
        finally:
            ctx.log.removeHandler(handler)
            handler.close()
            self._contexts.pop(ctx.job_id, None)
```

Note the select import is unused in the sketch above; drop it in the real file.

`app/pagination.py`:

```python
import base64
import json


def encode_cursor(**kv) -> str:
    return base64.urlsafe_b64encode(json.dumps(kv, default=str).encode()).decode()


def decode_cursor(s: str | None) -> dict:
    if not s:
        return {}
    try:
        return json.loads(base64.urlsafe_b64decode(s.encode()).decode())
    except Exception:
        from app.errors import AppError
        raise AppError("validation_error", "invalid cursor", 422) from None


def clamp_limit(limit: int | None) -> int:
    return max(1, min(1000, limit or 100))
```

`app/jobs/router.py`: `GET /projects/{projectId}/jobs` (query `state`, `type`, `limit`, `cursor`; ordered by `created_at desc, id desc`; the cursor carries `{created_at, id}` of the last item; fetch `limit + 1` rows to decide `next_cursor`), `GET .../jobs/{jobId}`, `POST .../jobs/{jobId}/cancel` (200 with the Job), `GET .../jobs/{jobId}/log?tail=200` returning `{"lines": [...], "path": "<relative log path>"}` reading the last `tail` lines of the file (empty list when the file does not exist yet). `app/jobs/schemas.py` holds `JobOut` with `from_row(row, project_id)` (adds `project_id`).

- [ ] **Step 4: Run tests, lint, commit**

Run: `.\.venv\Scripts\python -m pytest -q && .\.venv\Scripts\ruff check .`
Expected: all pass.

```bash
git add backend && git commit -m "feat(backend): job runner, jobs api and websocket events"
```

---

### Task 7: Stub routers and contract conformance test

**Files:**
- Create: `backend/app/datasets/router.py`, `backend/app/training/router.py`, `backend/app/providers/router.py`, `backend/app/inference/router.py`, `backend/tests/test_contract.py`

**Interfaces:**
- Produces: every path in `openapi.yaml` exists on the app; unimplemented ones raise `not_implemented(...)`. `tests/test_contract.py` validates responses against the spec with schemathesis and asserts that the set of routes on the app covers the set of paths in the spec.

- [ ] **Step 1: Write the failing conformance tests**

```python
from pathlib import Path

import schemathesis
import yaml
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from hypothesis import settings

SPEC = Path(__file__).resolve().parents[2] / "contract" / "openapi.yaml"
METHODS = ("get", "post", "put", "patch", "delete")


def test_every_spec_path_is_routed(app):
    spec = yaml.safe_load(SPEC.read_text("utf-8"))
    wanted = {(m.upper(), "/api/v1" + p) for p, ops in spec["paths"].items() for m in ops if m in METHODS}
    have = {(m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert wanted <= have, sorted(wanted - have)


schema = schemathesis.openapi.from_path(str(SPEC))


@schema.parametrize()
@settings(max_examples=5, deadline=None)
def test_responses_conform(case, app):
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as c:
        response = case.call(session=c, base_url="http://testserver")
        case.validate_response(response)
```

Use the schemathesis 4 API. If `case.call(session=...)` is not accepted by the installed version, use `case.call(transport_kwargs={...})` or run `schemathesis` through its ASGI transport: `schema = schemathesis.openapi.from_path(str(SPEC)); schema.config.base_url = "http://testserver"` and `case.call_and_validate(session=TestClient(app))`. Check the installed version's docs at `.venv/Lib/site-packages/schemathesis` before choosing. 501 responses conform through the `default` response.

- [ ] **Step 2: Add the stub routers**

Each stub router mounts every path of its resource with the exact method and path parameters from the contract and raises `not_implemented("<resource> <operation>")`. Datasets router: sources, images, boxes, datasets. Training router: models. Providers router: providers. Inference router: query-runs and preannotate. Path parameter names must match the contract exactly (`projectId`, `sourceId`, `imageId`, `boxId`, `datasetId`, `modelId`, `runId`, `jobId`, `provider`).

- [ ] **Step 3: Run, fix, commit**

Run: `.\.venv\Scripts\python -m pytest -q tests/test_contract.py`
Expected: pass. Spec and app disagree only by editing the spec (goal owner) and regenerating the client.

```bash
git add backend && git commit -m "test(backend): contract conformance with schemathesis and stub routers"
```

---

### Task 8: Frontend shell (Vite, React, Tailwind, router, API client, splash, error boundary)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js`, `frontend/index.html`, `frontend/eslint.config.js`, `frontend/.prettierrc`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/routes.tsx`, `frontend/src/index.css`, `frontend/src/test-setup.ts`, `frontend/src/vite-env.d.ts`, `frontend/src/api/backend.ts`, `frontend/src/api/client.tsx`, `frontend/src/api/events.ts`, `frontend/src/app/Splash.tsx`, `frontend/src/app/ErrorBoundary.tsx`, `frontend/src/app/Shell.tsx`, `frontend/src/app/diagnostics.ts`, `frontend/src/store/jobs.ts`, `frontend/src/screens/*.tsx` (8 placeholders), `frontend/src/api/backend.test.ts`, `frontend/src/store/jobs.test.ts`, `frontend/playwright.config.ts`, `frontend/e2e/boot.spec.ts`

**Interfaces:**
- Consumes: `createApiClient`, `eventsUrl`, types from `@contract/client` (Vite alias to `../contract/client`).
- Produces:
  - `resolveBackend(): Promise<{baseUrl: string; token: string; mode: "tauri" | "env" | "mock"}>` in `api/backend.ts`. Order: if `window.__TAURI_INTERNALS__` exists, `invoke("backend_info")`; else if `import.meta.env.APP_BACKEND_URL` is set, use it with `import.meta.env.APP_BACKEND_TOKEN`; else `{baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock"}`.
  - `waitForHealth(client, timeoutMs, intervalMs): Promise<Health>` in `api/backend.ts`.
  - `useApi(): ApiClient`, `useBackend(): BackendInfo` and `ApiProvider` in `api/client.tsx`.
  - `connectEvents(url, onEvent): () => void` with reconnect and backoff (1 s doubling to 10 s) in `api/events.ts`.
  - `useJobsStore` (zustand) with `jobs: Record<string, Job>`, `applyEvent(ev: AppEvent)`, `upsert(job)`, `active(): Job[]`.
  - `pushLog(line: string)` and `collectDiagnostics(): string` in `app/diagnostics.ts` holding the last 200 UI log lines plus the backend URL, mode and last health payload. The backend app log is not exposed by the contract; S5 may add a diagnostics endpoint through the goal owner.
- Routes: `/` Projects, `/p/:projectId/data`, `/p/:projectId/edit/:imageId`, `/p/:projectId/review`, `/p/:projectId/models`, `/p/:projectId/train`, `/p/:projectId/query`, `/p/:projectId/settings`. Each screen other than Projects is a placeholder that renders its title as an `<h1>` and the project id.

- [ ] **Step 1: Scaffold**

```powershell
cd E:\Dev\Yolo\app\frontend
pnpm init
pnpm add react@18 react-dom@18 react-router-dom@6 zustand@5 openapi-fetch@0.13 konva@9 react-konva@18 @tauri-apps/api@2 @tauri-apps/plugin-shell@2 @tauri-apps/plugin-dialog@2
pnpm add -D vite@6 @vitejs/plugin-react@4 typescript@5 @types/react@18 @types/react-dom@18 tailwindcss@3 postcss autoprefixer vitest@3 @testing-library/react@16 @testing-library/jest-dom@6 jsdom @playwright/test@1 eslint@9 typescript-eslint@8 eslint-plugin-react-hooks eslint-plugin-react-refresh prettier@3 @tauri-apps/cli@2
```

`package.json` scripts:

```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "lint": "eslint src && prettier --check src",
  "format": "prettier --write src",
  "e2e": "playwright test",
  "tauri": "tauri"
}
```

`vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contract/client": path.resolve(__dirname, "../contract/client"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  envPrefix: ["VITE_", "APP_"],
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  clearScreen: false,
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], include: ["src/**/*.test.{ts,tsx}"] },
});
```

`envPrefix` including `APP_` is what makes `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` visible as `import.meta.env.APP_BACKEND_URL` (spec section 10). `tsconfig.json` sets `"paths": {"@contract/client": ["../contract/client"], "@/*": ["src/*"]}` and includes `../contract/client` in `include`.

- [ ] **Step 2: Write failing tests**

`src/api/backend.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("resolveBackend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (window as any).__TAURI_INTERNALS__;
  });
  it("falls back to the mock server", async () => {
    vi.stubEnv("APP_BACKEND_URL", "");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" });
  });
  it("uses APP_BACKEND_URL when set", async () => {
    vi.stubEnv("APP_BACKEND_URL", "http://127.0.0.1:8765");
    vi.stubEnv("APP_BACKEND_TOKEN", "abc");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:8765", token: "abc", mode: "env" });
  });
  it("asks tauri when running inside the shell", async () => {
    (window as any).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:5555", token: "t" }),
    }));
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({ baseUrl: "http://127.0.0.1:5555", token: "t", mode: "tauri" });
  });
});
```

`src/store/jobs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { useJobsStore } from "./jobs";

const job = {
  id: "j1", project_id: "p", type: "import", state: "queued", progress: 0, message: "",
  log_path: "runs/j1/job.log", params: {}, result: null, error: null,
  created_at: "2026-09-17T00:00:00Z", started_at: null, finished_at: null,
} as any;

describe("jobs store", () => {
  it("applies progress and state events", () => {
    const s = useJobsStore.getState();
    s.upsert(job);
    s.applyEvent({ type: "job.progress", project_id: "p", job_id: "j1", progress: 0.5, message: "half", payload: {} } as any);
    expect(useJobsStore.getState().jobs.j1.progress).toBe(0.5);
    expect(useJobsStore.getState().active().map((j) => j.id)).toEqual(["j1"]);
    s.applyEvent({ type: "job.state", project_id: "p", job_id: "j1", progress: 1, message: "", payload: { state: "succeeded" } } as any);
    expect(useJobsStore.getState().jobs.j1.state).toBe("succeeded");
    expect(useJobsStore.getState().active()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test`
Expected: fail, modules missing.

- [ ] **Step 4: Implement**

`src/api/backend.ts`:

```ts
import type { ApiClient, Health } from "@contract/client";

export type BackendInfo = { baseUrl: string; token: string; mode: "tauri" | "env" | "mock" };

export async function resolveBackend(): Promise<BackendInfo> {
  if ((window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ base_url: string; token: string }>("backend_info");
    return { baseUrl: info.base_url, token: info.token, mode: "tauri" };
  }
  const url = import.meta.env.APP_BACKEND_URL as string | undefined;
  if (url) return { baseUrl: url, token: (import.meta.env.APP_BACKEND_TOKEN as string) ?? "", mode: "env" };
  return { baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" };
}

export async function waitForHealth(client: ApiClient, timeoutMs = 60_000, intervalMs = 500): Promise<Health> {
  const t0 = Date.now();
  let lastError = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { data, error } = await client.GET("/health");
      if (data) return data;
      lastError = JSON.stringify(error);
    } catch (e) {
      lastError = String(e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`backend not healthy after ${timeoutMs} ms: ${lastError}`);
}
```

`src/api/client.tsx`: React context holding `{client, info, health}`; `ApiProvider` renders `Splash` (text "Starting backend") until `waitForHealth` resolves, then children; on failure it renders the blocking dialog from spec section 11 with the message, the backend URL and mode, and a "Restart" button that re-runs resolve and poll (in Tauri mode it first invokes `restart_backend`). `useApi()` throws if used outside the provider.

`src/api/events.ts`:

```ts
import type { AppEvent } from "@contract/client";
import { pushLog } from "@/app/diagnostics";

export function connectEvents(url: string, onEvent: (ev: AppEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 1000; pushLog("events: connected"); };
    ws.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { pushLog(`events: bad message ${e}`); } };
    ws.onclose = () => { if (!closed) { pushLog(`events: closed, retry in ${delay} ms`); setTimeout(open, delay); delay = Math.min(delay * 2, 10_000); } };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => { closed = true; ws?.close(); };
}
```

`src/store/jobs.ts`:

```ts
import { create } from "zustand";
import type { AppEvent, Job } from "@contract/client";

const ACTIVE = new Set(["queued", "running"]);

interface JobsState {
  jobs: Record<string, Job>;
  upsert: (job: Job) => void;
  applyEvent: (ev: AppEvent) => void;
  active: () => Job[];
}

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: {},
  upsert: (job) => set((s) => ({ jobs: { ...s.jobs, [job.id]: job } })),
  applyEvent: (ev) =>
    set((s) => {
      if (!ev.job_id || !s.jobs[ev.job_id]) return s;
      const cur = s.jobs[ev.job_id];
      if (ev.type === "job.progress") {
        return { jobs: { ...s.jobs, [ev.job_id]: { ...cur, progress: ev.progress ?? cur.progress, message: ev.message ?? cur.message } } };
      }
      if (ev.type === "job.state") {
        const p = (ev.payload ?? {}) as Partial<Job>;
        return { jobs: { ...s.jobs, [ev.job_id]: { ...cur, ...p, progress: ev.progress ?? cur.progress } } };
      }
      return s;
    }),
  active: () => Object.values(get().jobs).filter((j) => ACTIVE.has(j.state)),
}));
```

`src/app/Shell.tsx`: left nav with links to the eight screens, top bar with project name and a jobs indicator (count of active jobs from the store). Tailwind only, no component library.

`src/app/ErrorBoundary.tsx`: class component; on error renders the message and a "Copy diagnostics" button calling `navigator.clipboard.writeText(collectDiagnostics())`.

`src/screens/ProjectsScreen.tsx`: `<h1>Projects</h1>`, lists `GET /projects` items (name, folder, open button) and has a "Create project" form (name, folder, classes textarea one per line, default the eight classes `excavator, wheel_loader, bulldozer, dump_truck, crane, concrete_mixer, roller, backhoe`) posting to `POST /projects`, and an "Open folder" form posting to `POST /projects/open`. In Tauri mode the folder fields use `open({directory: true})` from `@tauri-apps/plugin-dialog`; in browser mode they are plain text inputs. Navigates to `/p/:id/data` on success. The other seven screens render `<h1>` with their name.

`App.tsx`: `ErrorBoundary > ApiProvider > EventsBridge > RouterProvider`. `EventsBridge` connects `connectEvents(eventsUrl(info.baseUrl, info.token), useJobsStore.getState().applyEvent)` once and disposes on unmount.

- [ ] **Step 5: Run unit tests, lint, build**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: tests pass, no lint errors, `dist/` produced.

- [ ] **Step 6: Playwright boot test against the mock server**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1420", headless: true },
  webServer: [
    { command: "pnpm --dir ../contract mock", url: "http://127.0.0.1:4010/api/v1/health", reuseExistingServer: true, timeout: 60_000, ignoreHTTPSErrors: true },
    { command: "pnpm dev", url: "http://127.0.0.1:1420", reuseExistingServer: true, timeout: 60_000 },
  ],
});
```

Prism returns 401 for the health URL without a token; Playwright treats any HTTP response as "up", so this works.

`e2e/boot.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
test("boots against the mock server and lists projects", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Ahmadia")).toBeVisible(); // the Project example name in openapi.yaml
});
```

Run: `pnpm exec playwright install chromium` (browser download under the user profile, not a system install) then `pnpm e2e`.
Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add frontend && git commit -m "feat(frontend): vite react shell with api client, splash, events and screens"
```

---

### Task 9: Rust toolchain and Tauri shell with sidecar boot

**Files:**
- Create: `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/build.rs`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/capabilities/default.json`, `frontend/src-tauri/src/main.rs`, `frontend/src-tauri/src/lib.rs`, `frontend/src-tauri/src/sidecar.rs`, `frontend/src-tauri/icons/*` (generated with `pnpm tauri icon` from a placeholder 1024 px PNG), `frontend/src-tauri/binaries/.gitkeep`, `backend/machinery_backend.spec`, `backend/scripts/build.ps1`

**Interfaces:**
- Produces: Tauri commands `backend_info() -> {base_url, token}` and `restart_backend()`; sidecar named `machinery-backend` (binary at `src-tauri/binaries/machinery-backend-x86_64-pc-windows-msvc.exe` plus its `_internal` folder as a resource); when `APP_BACKEND_URL` is set in the process environment at launch, the sidecar is not spawned and `backend_info` returns that URL with `APP_BACKEND_TOKEN`.

- [ ] **Step 1: Install Rust (the single allowed system install) and record it**

```powershell
winget install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements
rustup default stable-x86_64-pc-windows-msvc
rustc --version; cargo --version
```

Then add a line to `docs/progress.md` under "System installs": the rustup version, the toolchain, and the date.

- [ ] **Step 2: Scaffold Tauri**

```powershell
cd E:\Dev\Yolo\app\frontend
pnpm tauri init --app-name "Machinery Detection" --window-title "Machinery Detection" --frontend-dist ../dist --dev-url http://127.0.0.1:1420 --before-dev-command "pnpm dev" --before-build-command "pnpm build"
```

`tauri.conf.json` additions:

```json
{
  "identifier": "ai.synapse-solutions.machinery-app",
  "productName": "Machinery Detection",
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "externalBin": ["binaries/machinery-backend"],
    "resources": { "binaries/_internal/": "_internal/" },
    "windows": { "webviewInstallMode": { "type": "downloadBootstrapper" } }
  },
  "app": {
    "windows": [{ "title": "Machinery Detection", "width": 1400, "height": 900, "minWidth": 1024, "minHeight": 700 }]
  }
}
```

`Cargo.toml` dependencies: `tauri = { version = "2", features = [] }`, `tauri-plugin-shell = "2"`, `tauri-plugin-dialog = "2"`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `rand = "0.8"`. Library name `machinery_app_lib` (`[lib] name = "machinery_app_lib"`, `crate-type = ["staticlib", "cdylib", "rlib"]`). `capabilities/default.json` grants `core:default`, `shell:allow-execute` and `shell:allow-spawn` restricted to the `machinery-backend` sidecar, `shell:allow-kill`, `dialog:allow-open`, `dialog:allow-save`.

- [ ] **Step 3: Implement `src/sidecar.rs`**

```rust
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub struct Backend {
    pub base_url: String,
    pub token: String,
    pub child: Option<CommandChild>,
}
pub struct BackendState(pub Mutex<Option<Backend>>);

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn random_token() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    rand::thread_rng().sample_iter(&Alphanumeric).take(48).map(char::from).collect()
}

pub fn start(app: &AppHandle) -> Result<Backend, String> {
    if let Ok(url) = std::env::var("APP_BACKEND_URL") {
        return Ok(Backend { base_url: url, token: std::env::var("APP_BACKEND_TOKEN").unwrap_or_default(), child: None });
    }
    let port = free_port();
    let token = random_token();
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let (mut rx, child) = app
        .shell()
        .sidecar("machinery-backend")
        .map_err(|e| e.to_string())?
        .env("APP_PORT", port.to_string())
        .env("APP_TOKEN", &token)
        .env("APP_DATA_DIR", data_dir.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => eprintln!("[backend] {}", String::from_utf8_lossy(&l)),
                CommandEvent::Terminated(t) => {
                    eprintln!("[backend] terminated {:?}", t);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(Backend { base_url: format!("http://127.0.0.1:{port}"), token, child: Some(child) })
}

pub fn stop(state: &BackendState) {
    if let Some(b) = state.0.lock().unwrap().take() {
        if let Some(c) = b.child {
            let _ = c.kill();
        }
    }
}
```

`src/lib.rs`:

```rust
mod sidecar;
use tauri::Manager;

#[tauri::command]
fn backend_info(state: tauri::State<sidecar::BackendState>) -> Result<serde_json::Value, String> {
    let g = state.0.lock().unwrap();
    let b = g.as_ref().ok_or("backend not started")?;
    Ok(serde_json::json!({ "base_url": b.base_url, "token": b.token }))
}

#[tauri::command]
fn restart_backend(app: tauri::AppHandle, state: tauri::State<sidecar::BackendState>) -> Result<(), String> {
    sidecar::stop(&state);
    let b = sidecar::start(&app)?;
    *state.0.lock().unwrap() = Some(b);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sidecar::BackendState(std::sync::Mutex::new(None)))
        .setup(|app| {
            let b = sidecar::start(app.handle())?;
            *app.state::<sidecar::BackendState>().0.lock().unwrap() = Some(b);
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Destroyed = e {
                sidecar::stop(&w.state::<sidecar::BackendState>());
            }
        })
        .invoke_handler(tauri::generate_handler![backend_info, restart_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    machinery_app_lib::run()
}
```

- [ ] **Step 4: Build a lightweight sidecar to prove the mechanism**

`backend/machinery_backend.spec` (PyInstaller one-folder; S6 extends it with torch hidden imports and CUDA DLLs):

```python
# -*- mode: python -*-
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ["app/__main__.py"],
    pathex=["."],
    hiddenimports=collect_submodules("app") + [
        "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets.legacy",
    ],
    datas=[("app/db/migrations", "app/db/migrations")],
    excludes=["torch", "torchvision", "ultralytics", "cv2", "sahi"],  # S0 only; S6 removes this line
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="machinery-backend", console=True)
coll = COLLECT(exe, a.binaries, a.datas, name="machinery-backend")
```

`backend/scripts/build.ps1`:

```powershell
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
Set-Location $backend
& .\.venv\Scripts\pyinstaller.exe machinery_backend.spec --noconfirm
$bin = Join-Path $backend "..\frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item "dist\machinery-backend\machinery-backend.exe" (Join-Path $bin "machinery-backend-x86_64-pc-windows-msvc.exe") -Force
if (Test-Path (Join-Path $bin "_internal")) { Remove-Item (Join-Path $bin "_internal") -Recurse -Force }
Copy-Item "dist\machinery-backend\_internal" (Join-Path $bin "_internal") -Recurse
Write-Host "sidecar copied to $bin"
```

Run: `cd backend; .\scripts\build.ps1` then `$env:APP_TOKEN="x"; $env:APP_PORT="0"; .\dist\machinery-backend\machinery-backend.exe`
Expected: prints `{"event": "starting", "port": NNNN, ...}` and serves `/api/v1/health` with the token.

- [ ] **Step 5: Run the Tauri dev app**

Run: `cd frontend; pnpm tauri dev`
Expected: the window opens, the splash shows "Starting backend", the Projects screen appears within 15 s, and the terminal shows `[backend] {"event": "starting", ...}`. Closing the window ends the backend process (check with `Get-Process machinery-backend` returning nothing).

- [ ] **Step 6: Commit**

```bash
git add frontend/src-tauri backend/machinery_backend.spec backend/scripts && git commit -m "feat(tauri): shell that boots the backend sidecar with a per-launch token"
```

---

### Task 10: Dev script and CI

**Files:**
- Create: `scripts/dev.ps1`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `scripts/dev.ps1 -Mode mock|backend` starts the mock server or the real backend on 8765 with a generated token and then Vite with `APP_BACKEND_URL` and `APP_BACKEND_TOKEN` set.

- [ ] **Step 1: `scripts/dev.ps1`**

```powershell
param([ValidateSet("mock", "backend")] [string] $Mode = "mock")
$root = Split-Path $PSScriptRoot -Parent
if ($Mode -eq "mock") {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\contract'; pnpm mock"
  Set-Location "$root\frontend"
  pnpm dev
} else {
  $token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\backend'; `$env:APP_TOKEN='$token'; `$env:APP_PORT='8765'; .\.venv\Scripts\python -m app"
  $env:APP_BACKEND_URL = "http://127.0.0.1:8765"
  $env:APP_BACKEND_TOKEN = $token
  Set-Location "$root\frontend"
  pnpm dev
}
```

- [ ] **Step 2: `.github/workflows/ci.yml`**

Jobs on `windows-latest`: `contract` (pnpm install in `contract/`, `pnpm check`), `backend` (uv with Python 3.11.15, install `requirements-dev.txt` with the CPU torch index override `--index-url https://download.pytorch.org/whl/cpu` for the runner and `torch==2.14.0` without the local version tag, `ruff check`, `pytest`), `frontend` (pnpm install, `pnpm lint`, `pnpm test`, `pnpm build`, Playwright with chromium, `pnpm e2e`). A fourth job `sidecar-smoke` builds the PyInstaller folder and curls health; it runs on `workflow_dispatch` only because it takes long. GPU tests (`-m gpu`) do not run in CI.

- [ ] **Step 3: Commit**

```bash
git add scripts .github && git commit -m "chore: dev script and ci workflow"
```

---

### Task 11: Checkpoint 1 verification (goal owner)

- [ ] Run `backend`: `pytest -q` all green, `ruff check` clean.
- [ ] Run `contract`: `pnpm check` clean, `pnpm mock` and curl health with and without token.
- [ ] Run `frontend`: `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm e2e` green.
- [ ] Run `pnpm tauri dev`: window opens, sidecar starts, health passes, Projects screen renders; create a project in a temp folder from the UI and confirm `project.db` and subfolders exist.
- [ ] Record the commit hash, the elapsed cold start, and the results in `docs/progress.md` under "Checkpoint 1".

---

### Task 12: README

- [ ] Write "Build", "Run in development (mock server)", "Run in development (real backend)", "Run the tests" sections with the exact commands from Tasks 4, 8, 9 and 10, and commit: `git commit -m "docs: readme build, run and test instructions"`.
