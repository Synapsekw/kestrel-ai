"""Equipment family (unit B2). Importing this package registers its builders in REGISTRY."""

from app.asset_models.builders.equipment import (  # noqa: F401  (registers on import)
    jetty,
    power,
    process,
    rotating,
    tanks,
    vessels,
)
