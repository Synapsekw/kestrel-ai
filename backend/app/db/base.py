import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)
