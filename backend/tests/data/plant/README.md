# KIPIC Al-Zour plant fixtures

Reference data for the plant model generator (spec 2026-10-03-plant-model-generator §13).

| File | Source | Tracked |
| --- | --- | --- |
| `kipic_register.csv` | Cowork's "Al-Zour LNG Plant Model" artifact, `KIPIC_AlZour_Asset_Register.csv` (885 rows, 878 with coordinates, 404 tags, 46 types) | yes |
| `kipic_landmask.json` | the same artifact's `landmask.json` (`land` and `main` outlines) | yes |
| `KIPIC_AlZour_LNG_Plant.glb` | the same artifact's GLB (26 MB, 34 materials) | no (`.gitignore`); copy it from `.superpowers/sdd/pm-common/kipic/` or set `KESTREL_KIPIC_DIR` |

`contract/fixtures/plant-grid-vectors.json` is written from `kipic_register.csv` by `backend/scripts/plant_grid_vectors.py`.