"""The plant run (spec 2026-10-03-plant-model-generator §8). Kept import-light: the runner imports
`PLANT_MODES` on every asset-model run."""

PLANT_MODES: tuple[str, ...] = ("plant", "plant_package")
