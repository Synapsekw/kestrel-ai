"""`/project-templates` (spec 2026-09-30-project-setup section 9; plan S1-U2 Task 3). No prefix:
included by app/setup/router.py, which carries the tags. Every operation needs the catalogue (503
without it)."""

from fastapi import APIRouter, Depends, Response

from app.catalogue.handle import CatalogueHandle, get_catalogue
from app.setup import templates
from app.setup.schemas import (
    ProjectTemplateCreate,
    ProjectTemplateOut,
    ProjectTemplatePage,
    ProjectTemplatePatch,
)

router = APIRouter()


@router.get("/project-templates", response_model=ProjectTemplatePage)
def list_project_templates(cat: CatalogueHandle = Depends(get_catalogue)) -> ProjectTemplatePage:
    return ProjectTemplatePage(items=templates.list_templates(cat))


@router.post("/project-templates", response_model=ProjectTemplateOut, status_code=201)
def create_project_template(
    body: ProjectTemplateCreate, cat: CatalogueHandle = Depends(get_catalogue)
) -> ProjectTemplateOut:
    return templates.create_template(cat, body)


@router.patch("/project-templates/{templateId}", response_model=ProjectTemplateOut)
def patch_project_template(
    templateId: str,  # noqa: N803
    body: ProjectTemplatePatch,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> ProjectTemplateOut:
    return templates.patch_template(cat, templateId, body)


@router.delete("/project-templates/{templateId}", status_code=204)
def delete_project_template(templateId: str, cat: CatalogueHandle = Depends(get_catalogue)) -> Response:  # noqa: N803
    templates.delete_template(cat, templateId)
    return Response(status_code=204)
