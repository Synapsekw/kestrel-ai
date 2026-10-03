# I1 final fix wave
1. MAX_SOURCES 50 -> 200: grep of backend/app showed the only sources cap is schemas.py:194 (max_length=200); no runner/router/agent cap. Hint in BuildDialog names an oversized single file ("T0005.pdf has 201 pages; a run reads at most 200 sources."); new BuildDialog test.
2. test_cancel_fails_every_page_left: _spy gained `entered` Event; test waits on it before cancelling.
3. Startup sweep test seeds a ready row with the dead job_id, asserts it stays ready.
4. e2e drawings-import.spec.ts: pages route block re-indented by hand.
Verification: pytest test_drawings_pages_api 11 passed; ruff check/format clean; vitest src/assetmodels 127 passed; tsc -b ok; lint ok; prettier clean on touched src; e2e drawings-import + models-build 6 passed.
