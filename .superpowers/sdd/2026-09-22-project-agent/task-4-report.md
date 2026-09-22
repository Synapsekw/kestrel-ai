# Task 4 report: dispatch, selectors and the tool registry

Status: DONE_WITH_CONCERNS (the concerns are small; see the end)
Commit: `7fb9661 feat(agent): in-process API dispatch, image selectors and agent tools`

## What I built

### `backend/app/project_agent/dispatch.py`
- `ApiCallError(status, code, message, details)`, parsed from the Error envelope. A body that is not an envelope becomes `http_error` / `HTTP <status>`.
- `ApiCaller(app, token, project_id)`: an async context manager. It creates one `httpx.AsyncClient(ASGITransport(app), base_url="http://agent.local", Bearer token, timeout=60)` on first use, and `aclose()` closes it.
  - `call(method, path, json=, params=)`: a path starting with `/api/` is used as it is; any other path (including `""`, the project itself) is joined onto `/api/v1/projects/{project_id}`. `None` params are dropped and bools become `true`/`false`. It returns parsed JSON, or `None` for a 204 or an empty body, and raises `ApiCallError` for any status ≥ 400.
  - `fetch_bytes(path, params)`: returns the raw bytes, with the same error handling.
- `ImageSelector` (extra="forbid"), with exactly the brief's fields and bounds. The model sees field descriptions.
  - Deviation: the spec lists `marked_empty?` in the selector, but the brief's `ImageSelector` does not, and `listImages` has no such filter. I followed the brief and left it out.
- `resolve_selection(api, sel)`:
  - When `image_ids` is given: duplicates are removed, one `GET /images?ids=…&limit=len` call is made, and the ids that were found come back in the order given.
  - Otherwise it pages `GET /images` with the filters and follows `next_cursor`. Each page asks for `min(SELECT_PAGE, offset+limit-seen)` rows, so "first 500 of 600" takes 3 pages (200/200/100). It skips `offset`, stops at `limit`, and holds only ids. `SELECT_PAGE = 200` is a module constant that tests monkeypatch.

### `backend/app/project_agent/tools.py`
- `ToolContext`, `ToolOutcome`, `Prepared` and `Tool` are exactly as in the brief. `Tool` has class attributes `name / description / Args / risk / label`. By default `prepare` returns None and `run(ctx, args: dict)` does the work. I also added a private `ToolError` for refusals.
- `REGISTRY` holds all 35 tools, named as in the brief and with the brief's risks. `label_images` is `write`; its `prepare` returns `Prepared` only for a cloud labeler.
- `tool_specs()` builds `ToolSpec(name, description, _clean_schema(Args.model_json_schema()))`. `_clean_schema` does the following:
  - removes `title` recursively, but never removes a property that happens to be named "title";
  - inlines `#/$defs/...` refs, merges single-element `allOf`, and drops `$defs` and `discriminator`. The discriminator mapping points into `$defs`, so it has to go.
  - I did not touch `llm.py`.
- `run_tool(ctx, name, raw_args)`:
  - An unknown name returns an error outcome.
  - `ValidationError` becomes `Invalid arguments for X: loc: msg; …`. It never echoes the input.
  - `prepare()` returning `Prepared` makes `run_tool` return that `Prepared`. An approval tool whose prepare returns None is an error.
  - Otherwise it calls `run(ctx, args.model_dump(mode="json", by_alias=True))`.
  - `ApiCallError` becomes `The app refused the request (404 not_found): <envelope message>`. Validation errors from routes add `loc: msg` pairs.
  - `ToolError` returns its message.
  - Any other exception becomes a generic error. Only the exception type is logged.
  - The result is truncated to 8,000 chars and ends with a ` …[truncated]` marker.
- `execute_approved(ctx, name, prepared_args)` runs `tool.run(ctx, prepared_args)` with the same error handling and truncation.
- `render_image_b64(api, image_id)` is async. It calls `GET /images/{id}/file?max_side=1024` and returns base64, or `None` when the image is gone.
- Every id the model supplies goes into a URL through `quote(id, safe="")`, so an id cannot walk to another route.

Notes on individual tools:
- `update_classes`:
  - Classes are matched by name, exact first and then case-insensitive. An unknown `from` is an error that lists the project's classes.
  - Ids, colours and hotkeys are kept.
  - New classes get `PALETTE[len(items) % 8]` (the app's 8 class colours) and the next free hotkey from 1–9, or null when none is free.
  - A new class whose name already exists is skipped.
  - The `from` key uses the pydantic alias `from` (field `from_`), and the schema exposes `from`/`to`.
- `label_images`:
  - Local model: `prepare` returns None, and `run` resolves the selection and posts the query run.
  - Cloud: `prepare` checks `GET /api/v1/providers` for `has_key`. Without a key it returns an error that tells the model to ask the user to add one in Settings; the key itself is never read.
  - Cloud continued: `prepare` then resolves the ids, calls `POST query-runs/estimate`, and returns `Prepared("Label N images with <provider>", "N images · R requests · about $X.XX. Suggestions stay unreviewed until you accept them.", cost, args=<full QueryRunCreate body with resolved image_ids>)`. Nothing is created until `execute_approved`.
  - The result is `{query_run_id, job_id, images, kind}` with `job_ids=[job_id]`.
- `import_folder`:
  - The folder must be **absolute**: a drive letter or UNC.
  - After backslashes become slashes and everything is lower-cased, the folder must appear in a user text as a **whole path**. That means it starts after a start/space/quote/`([<:=`, and ends at end/space/quote/closing punctuation, or at a sentence-ending `.`, with an optional trailing slash.
  - Why: a plain substring check would have let the model import a parent folder (`E:\Data` when the user typed `E:\Data\Site A`), or even the whole drive. Both are refused, and tests cover this.
- `wait_for_job` polls every `WAIT_POLL_S = 2.0` s until the job is not queued/running, or until `seconds` (1–60) is up. It returns `finished: bool`.
- `open_screen` returns `navigate={"screen", "image_id"}`. The editor screen requires an `image_id`; other screens get `image_id: None`.
- `update_project` can set `name` and set a `preannotation_model_id`. Because the validated dump cannot tell "unset" from `null`, clearing uses a separate `clear_preannotation_model: bool`.
- Approval tools (`train_model`, `delete_images`, `delete_boxes`, `delete_dataset`, `delete_model`) resolve and validate in `prepare`: they GET the dataset or model, so an unknown id is an error before any card appears. The titles and details follow the brief's examples.
  - Example: "Train yolo-v2 for 50 epochs" / "Dataset v1 · base coco-n · imgsz 1280".
  - Example: "Delete 12 images" / "Removes the images and their boxes from the project; originals on disk are not touched."
  - `delete_boxes` returns `{deleted, not_found}`.
- Result sizes are bounded:
  - `find_images`: ≤ 50 rows (`FIND_ROWS`).
  - `get_image`: ≤ 100 boxes, plus `boxes_not_shown`.
  - `get_job`: 40 log lines, each cut to 300 chars.
  - List tools: 50 rows, or 20 for runs and jobs, and `more: true` only when there is another page.
  - `get_project`: ≤ 20 sources.

## How the tests drive ASGITransport
The tests enter the `client` fixture, which is `TestClient(app)` with the lifespan running, and then run each coroutine with **`client.portal.call(main)`**. That runs it on the TestClient's own event loop, the same loop that ran the lifespan and that serves requests. So `app.state` (jobs, events, keys) is populated, and route handlers publish events and submit jobs on the correct loop. This matches production, where the runner is a task on the server's loop.
- I did not use `asyncio.run` in the main thread. It would create a second loop, and the events hub, which is bound to the lifespan's loop, could misbehave there.
- `portal.call` has been reliable across 3 full runs.

## Tests: `backend/tests/test_project_agent_tools.py` (47 tests, ~27 s)
- Images are 12 noise JPEGs imported through `POST sources` with the existing `import_source` fixture, which waits for the job. `img00` is 1600×1000 for the render test; the rest are 96×64.
- Coverage:
  - caller path resolution and the envelope error;
  - paging with `SELECT_PAGE` patched to 5: pages requested `[5, 5, 2]`;
  - offset/limit in 5 cases, including past the end;
  - sort/filters/search, and ids kept in the given order with unknown ids dropped;
  - selector bounds and `extra="forbid"`;
  - `render_image_b64` returns a JPEG whose long side is 1024, or None for an unknown image;
  - the registry's names and risks, and that specs contain no `$ref`/`$defs`/`title`;
  - unknown tool and bad args, the API error message, and truncation (with a fake tool);
  - every read tool's output shape;
  - `update_classes` add+rename (ids kept, hotkey "9") and an unknown rename;
  - a local `label_images` run (a registered Model row plus a fake provider, and the job waited for);
  - unknown-model and no-images errors;
  - cloud `label_images` returns `Prepared` with the estimate and resolved ids, the key never appears in args or detail, no run exists before approval, and `execute_approved` creates it;
  - cloud without a key is refused;
  - `import_folder` refusal and acceptance (case and slash normalised, trailing backslash), plus an 8-case unit table for `_typed_by_user`;
  - the box/review/mark-empty tools;
  - accept and undo against an unknown run;
  - `update_project`, `open_screen`, `wait_for_job` and `cancel_job`;
  - approval tools return `Prepared` and change nothing;
  - `execute_approved` for `delete_images`;
  - dataset create → get/list → `train_model` Prepared → `delete_dataset` approved.

TDD evidence:
- RED: `python -m pytest tests/test_project_agent_tools.py -q` gave `ImportError: cannot import name 'tools' from 'app.project_agent'` (1 error during collection).
  - Caveat: I wrote `dispatch.py` before the test file, so for dispatch the RED was only at collection level through the shared imports.
- GREEN: `47 passed in 26.63s`.
- `ruff check` on my 3 files: "All checks passed!". `ruff format` leaves them unchanged.

Full backend suite: `1 failed, 789 passed, 9 deselected`. The only failure is `tests/test_contract.py::test_every_spec_path_is_routed`, because the contract's `/agent` and `/agent/turns…` routes are not wired yet. Those belong to a later task, not to my files.

## Files
- `backend/app/project_agent/dispatch.py` (new)
- `backend/app/project_agent/tools.py` (new)
- `backend/tests/test_project_agent_tools.py` (new)

## Self-review and concerns
1. The selector has no `marked_empty` filter. The spec mentions one, but the brief and `listImages` do not; this needs a contract change if it is wanted.
2. `_clean_schema` is private in `tools.py`, as instructed. Task 5 can swap it for `llm.clean_schema` if one exists.
3. `update_project` clears the model with an explicit `clear_preannotation_model` flag rather than `preannotation_model_id: null`.
4. `label_images` (cloud) checks for the key through `GET /api/v1/providers` (`has_key` only), so the model hears "no key" before it asks the user to approve. The key is never read.
5. `wait_for_job` counts as "write" because the brief says so, although it only reads.
6. Stored `Prepared.args` for cloud labeling holds up to 5,000 image ids. That is fine for JSON storage but worth knowing for Task 5's item row size.

## Fix round 1 (commit d1a2431 `fix(agent): mutating image tools require an explicit selection`)

Finding: `selection` defaulted to `ImageSelector()`, which means the first 100 images by path. A model that left `selection` out could therefore mark, label or delete 100 arbitrary images.

Changes in `tools.py`:
- `_selection_field(required=True)` has no default, and its description now ends with "Required: say exactly which images."
- `mark_images_empty` (`MarkEmptyArgs`) and `delete_images` (`DeleteImagesArgs`) now use it.
- `label_images` (`LabelArgs`) now uses it too. `estimate_labeling` gets its own `EstimateArgs`, which keeps the default. Before this fix the two tools shared `LabelArgs`.
- `find_images` keeps its default selection.
- `create_dataset` and `export_results` keep their optional `selection`. When it is `None` they send no `image_ids`, so the server's documented defaults apply (every labeled image or every image); nothing is picked arbitrarily.

Covering tests, in `test_project_agent_tools.py`:
- `test_mutating_tools_require_an_explicit_selection[mark_images_empty|label_images|delete_images]`: calling each tool without `selection` returns an `is_error` outcome that names `selection`. The test then checks that nothing changed: all 12 images are still there, none is marked empty, and no query run exists.
- `test_read_tools_keep_the_default_selection`: `find_images` and `estimate_labeling` still work without `selection`, and `tool_specs()` lists `selection` in `required` for the three mutating tools.
- Two existing tests that left `selection` out of `label_images` now pass `{"limit": 2}`.

TDD evidence:
- RED: `python -m pytest tests/test_project_agent_tools.py -q -k "require_an_explicit or keep_the_default"` gave `4 failed, 47 deselected`.
- GREEN: `python -m pytest tests/test_project_agent_tools.py -q` gave `51 passed in 31.12s`.
- `ruff format` left both files unchanged, and `ruff check` reported "All checks passed!".
