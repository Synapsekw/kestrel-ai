"""Helper to mount 501 placeholders so the contract is fully routed before a sub-project lands.

No router uses it right now: every contract operation is built. It is kept on purpose as the way a
future unit routes its operations as 501 stubs before it lands (as the C x BM fix did for BM);
`tests/test_contract.py` then lists those operations as expected 501s.
"""

from fastapi import APIRouter, Body, Depends

from app.errors import not_implemented
from app.projects.service import ProjectHandle, get_project


def _make(name: str, project_scoped: bool):
    if project_scoped:

        def stub(handle: ProjectHandle = Depends(get_project), body: dict | None = Body(None)):
            raise not_implemented(name)

    else:

        def stub(body: dict | None = Body(None)):
            raise not_implemented(name)

    stub.__name__ = "stub_" + name.replace(" ", "_").replace("-", "_")
    return stub


def add_stubs(router: APIRouter, stubs: list[tuple[str, str, str]], project_scoped: bool = True) -> None:
    """stubs: (method, path, name). Project-scoped stubs resolve the project first (404 when unknown)."""
    for method, path, name in stubs:
        router.add_api_route(path, _make(name, project_scoped), methods=[method], name=name)
