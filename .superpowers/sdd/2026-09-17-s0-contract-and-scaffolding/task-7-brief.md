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

