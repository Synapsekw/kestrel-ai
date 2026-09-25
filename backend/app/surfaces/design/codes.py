"""Warnings and candidate notes (spec §12 `DesignWarning`): a code, a level and a readable message."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

Level = Literal["info", "warn", "block"]


@dataclass(frozen=True)
class DesignNote:
    code: str
    level: Level
    message: str

    def to_json(self) -> dict:
        return asdict(self)

    @classmethod
    def from_json(cls, d: dict) -> DesignNote:
        return cls(d["code"], d["level"], d["message"])


def info(code: str, message: str) -> DesignNote:
    return DesignNote(code, "info", message)


def warn(code: str, message: str) -> DesignNote:
    return DesignNote(code, "warn", message)


def block(code: str, message: str) -> DesignNote:
    return DesignNote(code, "block", message)
