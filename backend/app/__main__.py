"""Process entry point: `python -m app` serves the API, `python -m app worker ...` trains,
`python -m app geo-selftest` checks GDAL/PROJ, `pointcloud-selftest`, `design-selftest` and
`volumes-selftest` check the point-cloud, design-surface and volume-export stacks (placeholders until
S1 K2, S3 U3 and S2 V6 build them).
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
    if len(argv) > 1 and argv[1] == "pointcloud-selftest":
        from app.pointclouds.selftest import main as pointcloud_selftest

        return pointcloud_selftest(argv[2:])
    if len(argv) > 1 and argv[1] == "design-selftest":
        from app.surfaces.design.selftest import main as design_selftest

        return design_selftest(argv[2:])
    if len(argv) > 1 and argv[1] == "volumes-selftest":
        from app.volumes.selftest import main as volumes_selftest

        return volumes_selftest(argv[2:])
    from app.main import main

    main()
    return 0


if __name__ == "__main__":
    sys.exit(run(sys.argv))
