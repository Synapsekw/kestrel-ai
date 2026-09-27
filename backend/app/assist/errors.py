"""Errors of the smart-polygon package (kept apart so the lazily imported backend and the service
can both raise them without importing each other)."""


class AssistUnavailable(Exception):
    """SAM cannot run here: its modules are missing from the build, or the model will not load."""
