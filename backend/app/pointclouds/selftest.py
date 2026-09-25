"""`kestrel-backend.exe pointcloud-selftest`: the frozen-bundle check for the point-cloud stack.

A placeholder until unit K2 builds it (spec 2026-09-23-point-clouds section 14): it says so and
exits 2, so a smoke script that calls it before K2 fails loudly rather than passing on nothing.
"""

NAME = "pointcloud-selftest"


def main(argv: list[str] | None = None) -> int:
    print(f"{NAME} not built", flush=True)
    return 2
