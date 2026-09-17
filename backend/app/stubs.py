"""Helper to mount 501 placeholders so the contract is fully routed before a sub-project lands."""

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
