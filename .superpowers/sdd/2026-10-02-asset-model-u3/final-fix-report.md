# U3 final fix report

1. PATCH name null: field_validator on AssetModelPatch.name -> 422 validation_error. Test test_patch_name_null_is_422 (tag null still 200).
2. GLB stuck pending: jobs_glb.py now registers on_cancelled_before_start (marks failed, publishes), spec load moved inside try, tmp defined before try and unlinked on failure. Tests: test_cancel_before_start_marks_failed, test_spec_load_failure_marks_failed, test_failed_write_leaves_no_tmp.
3. test_migration_0015: STRUCTURAL filter and _table helper removed; scoped by repr(d), asserts [] over all kinds (passes).
4. test_spec_used_is_the_stored_one: seeds height 3000, runs run_glb, asserts top_m == approx(3.0).
5. test_contract.py stale comment reworded.
6. test_sweep_leaves_a_live_job_alone added.
7. GLB_JOB defined once in jobs_glb.py, imported by service.py (no cycle).
8. Router resolves model (404) before parse_spec; test_bad_spec_on_a_missing_model_is_404.
9. test_delete_removes_rows_and_folder asserts version rows gone.

Commands (from backend, shared venv): pytest tests/test_asset_models_*.py tests/test_migration_0015.py -q -> 33 passed; tests/test_contract.py -q -> 298 passed; ruff check -> all passed; ruff format --check -> 967 files formatted.
