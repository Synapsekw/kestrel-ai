"""`kestrel-backend.exe design-selftest`: the frozen-bundle check for design-surface import.

A placeholder until S3 unit U3 builds it (spec 2026-09-23-design-surfaces section 14.2): it says so
and exits 2, so a smoke script that calls it before U3 fails loudly rather than passing on nothing.
"""

NAME = "design-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
