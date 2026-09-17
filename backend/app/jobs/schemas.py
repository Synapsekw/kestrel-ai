from datetime import datetime
from typing import Any

from pydantic import BaseModel

from app.db.models import Job


class JobOut(BaseModel):
    id: str
    project_id: str
    type: str
    state: str
    progress: float
    message: str
    log_path: str
    params: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    @classmethod
    def from_row(cls, row: Job, project_id: str) -> "JobOut":
        return cls(
            id=row.id,
            project_id=project_id,
            type=row.type,
            state=row.state,
            progress=row.progress,
            message=row.message,
            log_path=row.log_path,
            params=row.params or {},
            result=row.result,
            error=row.error,
            created_at=row.created_at,
            started_at=row.started_at,
            finished_at=row.finished_at,
        )


class JobPage(BaseModel):
    items: list[JobOut]
    next_cursor: str | None


class JobLog(BaseModel):
    lines: list[str]
    path: str
