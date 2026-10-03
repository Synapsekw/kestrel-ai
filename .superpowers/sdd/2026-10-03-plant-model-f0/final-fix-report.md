# F0 final-fix report
Fixes: (1) validate._check_plant reports blocking `reserved_id` for item/env id "world" (same code/message as M1 parts); (2) jobs_glb generic-exception branch now keeps meta["validation"] when a large spec was checked.
RED: both new tests failed before the fix (test_an_item_or_environment_id_of_world_is_reserved, test_a_build_failure_after_validation_keeps_the_report; 2 failed).
GREEN: `pytest tests/test_plant_validate.py tests/test_asset_models*.py` -> 45 passed. ruff check + format clean.
Files: backend/app/asset_models/validate.py, jobs_glb.py, backend/tests/test_plant_validate.py.
