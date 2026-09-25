"""`kestrel-backend.exe volumes-selftest`: the frozen-bundle check for the volume exports.

A placeholder until S2 Task 13 (unit V6) builds it (spec 2026-09-23-volumes section 12.2): it says
so and exits 2, so a smoke script that calls it before V6 fails loudly rather than passing on nothing.
"""

NAME = "volumes-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
