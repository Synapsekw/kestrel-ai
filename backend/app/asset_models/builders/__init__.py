"""Plant item builders (spec 2026-10-03-plant-model-generator §6): the registry in `base`, shared
geometry in `geom`, Cowork's materials in `palette`, the fallback family in `fallback`, and one
module or package per family (structure, equipment, building, civil, environment) owned by B1 to B3.

Import nothing here: `base.load_all()` imports the families, and family modules import `base`.
"""
