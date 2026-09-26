"""The operator's name on comments (C0 `getOperatorSettings`/`putOperatorSettings`)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.findings import comments

router = APIRouter(tags=["findings"])


class OperatorSettings(BaseModel):
    operator_name: str | None = Field(default=None, max_length=80)


@router.get("/settings/operator", response_model=OperatorSettings)
def get_operator_settings(request: Request) -> OperatorSettings:
    return OperatorSettings(operator_name=comments.operator_name(request.app.state.settings.data_dir))


@router.put("/settings/operator", response_model=OperatorSettings)
def put_operator_settings(body: OperatorSettings, request: Request) -> OperatorSettings:
    name = comments.set_operator_name(request.app.state.settings.data_dir, body.operator_name)
    return OperatorSettings(operator_name=name)
