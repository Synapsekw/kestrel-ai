"""Process entry point: `python -m app` serves the API, `python -m app worker ...` trains,
`python -m app geo-selftest` checks GDAL/PROJ.
"""

import multiprocessing
import sys
from collections.abc import Callable


def run(argv: list[str], freeze_support: Callable[[], None] = multiprocessing.freeze_support) -> int:
    """Dispatch one invocation of this entry point.

    `freeze_support()` comes first and is not optional: Ultralytics trains with `workers > 0`, so on
    Windows every DataLoader worker is spawned as a fresh process. In a frozen build that process is
    `<exe> --multiprocessing-fork <handle>`, which would otherwise fall through to the API branch and
    have every dataloader worker start a server. `freeze_support()` recognises such a child, runs its
    work and exits; for a real launch it is a no-op.
    """
    freeze_support()
    from app.maps.gdal_env import configure_gdal_env

    configure_gdal_env()  # before anything imports rasterio; a no-op outside the frozen build
    if len(argv) > 1 and argv[1] == "worker":
        from app.training.worker import main as worker_main

        return worker_main(argv[2:])
    if len(argv) > 1 and argv[1] == "geo-selftest":
        from app.maps.selftest import main as geo_selftest

        return geo_selftest()
    from app.main import main

    main()
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv))
