# Foundation BC: catalogue, project types and findings core. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Where and when this runs.** The executor works in its own worktree `.claude/worktrees/f-bc` on
> branch `task/f-bc`, cut from `main` **after unit C0 (the contract) has merged** (index: "Cut
> after"). Tasks 1–4 need only C0. **Before Task 5** (the first task that consumes BK's hand-offs),
> unit BK (kind removal, Data list, search, app jobs) must be on `main` and this branch rebased onto
> it; before Task 14's merge, it also rebases onto MG-framework. It implements against the contract C0 landed. When this
> plan was written, C0's plan (`docs/superpowers/plans/2026-09-26-foundation-c0-contract.md`) did not
> exist yet, so every path, schema and field name below is spec §13 verbatim. Task 1 Step 1 reads
> C0's `contract/openapi.yaml` and corrects the names table **before** any code is written. BK's plan
> (`docs/superpowers/plans/2026-09-26-foundation-bk-kind-removal-data-list.md`) did exist, and the
> hand-offs it names for BC are built here (Task 5, Task 8).

**Goal:** Build the app-wide catalogue and severity scale, the project type list, and the finding
core (tables, numbers, status rules, counts, activity, comments, attachments, the annotation
invariant, the defect backfill job and the Overview endpoint), so that I, M, C, R, S1 and S2 only
have to call it.

**Architecture:**
- **Catalogue.** A new package `app/catalogue/` owns `catalogue.db`, a third SQLite file next to
  `library.db` with its own Alembic history (revision `0001`). It is shaped like `app/library/`: a
  `CatalogueHandle` with `session()`, `open_catalogue()` called from the lifespan with the same
  failure contract (log, `app.state.catalogue = None`, 503 `catalogue_unavailable`). The public
  entries for BM and MG are `resolve_types` (by id), `find_by_names` and `ensure_types` (by
  `normalise_name`) and `add_project_types`, named as BM's and MG's plans already call them.
- **Project side.** Project migration `0010` (BC is its sole writer) adds `project_type` (a
  snapshot of each catalogue type the project uses), the finding tables, the pre-aggregated counts,
  the activity feed and MG's two bookkeeping tables, and drops `project.kind`. `Project.classes`
  becomes a read-only property derived from `project_type`, so every existing reader of
  `handle.row(s).classes` keeps working unchanged.
- **Findings.** A new package `app/findings/`. Every write goes through `service.py`, which calls
  `counts.change` (the only writer of `finding_count`/`finding_daily`) and `events.mark_changed`
  inside the caller's transaction. The box service calls `findings/annotations.py` hooks in its own
  transaction, so an annotation on a defect type **is** a finding's geometry. `overview/` reads only
  pre-aggregated rows.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, SQLite (WAL, `foreign_keys=ON`), Pillow, pyproj
(already dependencies), pytest + schemathesis (already dependencies). No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-26-foundation-design.md` (§7, §8, §9.1, §9.2
`ProjectSummary`, §11.1 row `0010`, §13–§16, §18 unit BC), under the umbrella
`docs/superpowers/specs/2026-09-26-inspection-platform-design.md` (§3 domain model, §10
reconciliation items 4, 5, 6, 7, 26).

**Budget (AGENTS.md item 6):**
- **Background jobs:** `findings_backfill` (library runner; walks the recent projects one at a
  time, boxes in batches of 1000 per transaction), `findings_recount` (project runner). The
  attachment copy is synchronous: the one sanctioned exception, capped at 50 MB and validated with
  Pillow before a byte is copied (spec §14).
- **Bounded reads:** the findings list is keyset-paged, `limit` ≤ 500, on indexed filters. The
  Overview, the findings summary and `ProjectOut.summary` read only `finding_count`,
  `finding_daily` (≤ 61 rows), `project_type`, small-table `COUNT`s and `SUM(source.image_count)`;
  a statement-count test pins that they never read `finding`, `box` or `image`. Search is `LIMIT`
  ≤ 20. A finding thumbnail is one crop read, then cached. The catalogue lists page with
  `clamp_limit`. `severity_in_use` reads one `SUM` per **open** project (≤ 20).

**DAG position (spec §18):** BC is in **batch 2** (`DS ∥ BK ∥ BC ∥ BM ∥ MG-framework`), after C0.
Merge order inside batch 2 (the index, which supersedes spec §18): **BK → MG-framework → BC →
BM** (DS any time), so BC rebases onto BK and MG-framework and merges third. MG-framework's backup
guard must be on `main` before `0010` is. Downstream consumers:
- **BM** calls `app.catalogue.service.resolve_types`, `find_by_names`, `ensure_types`,
  `add_project_types` and `normalise_name` through its `CatalogueAdapter` (it stubs them until BC
  merges; `docs/superpowers/plans/2026-09-26-foundation-bm-models-backend.md` Task 11).
- **MG-steps** (batch 3, needs BC and BM merged) call `open_catalogue_db`, `ensure_types(...,
  origin="migrated")`, `set_meta(NEEDS_CLASSIFICATION)`, `project_types.set_types`,
  `findings_from_annotations`, `counts.recount`, `activity.record`, and append to
  `overview.service.BANNER_PROVIDERS`.
- **S1** (Overview, Findings tab, inspector) and **S2** (Catalogue screen) consume the endpoints.
- **I, M, C** call `findings.service.create_in_session` and use `findingHref`'s anchor fields.

**Internal execution DAG.** One worktree, one implementer at a time (ADR
`2026-09-23-gotcha-parallel-branches-collide-on-migration-ids`: never two implementers in one
worktree), so the tasks run in order. Their dependencies:

```
T1 catalogue storage ─ T2 catalogue service ─┐
T3 migration 0010 + ORM ─────────────────────┼─ T4 catalogue API ─ T5 project types ─┐
                                             │                                      │
T6 counts, activity, numbers, events (T3) ───┴──────────────────────────────────────┼─ T7 finding service
T7 ─ T8 query, bulk, summary ─ T9 findings API ─ T10 comments, attachments, thumbnail
T7 ─ T11 annotation invariant ─ T12 backfill job
T8 ─ T13 overview + ProjectSummary
T10, T12, T13 ─ T14 gate, ADR, merge
```

T1 and T3 are independent, and so are T10, T11 and T13 once their inputs land. **Critical path:**
T3 → T5 → T6 → T7 → T11 → T12 → T14 (the invariant and the backfill are the riskiest code, and MG
waits on T12's function).

## Global Constraints

- **Worktree and interpreter.** Build only in `E:\Dev\Yolo\app\.claude\worktrees\f-bc`. The worktree
  has no venv (CONTRIBUTING.md, "A worktree has no venv of its own"). Every backend command runs
  from `E:\Dev\Yolo\app\.claude\worktrees\f-bc\backend` with
  `$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"`. Never create a venv.
- **Contract.** `contract/openapi.yaml` is C0's. BC does not edit `contract/`. If a BC route cannot
  match C0's schema, record it in the final report; do not edit the contract.
- **Migration ids.** BC writes exactly two revisions: catalogue `0001` (`down_revision = None`) and
  project `0010` (`down_revision` = `main`'s project head at merge time, `"0009"` today). No library
  revision (BM owns `0002`). Project `0011`–`0014` and catalogue `0002` belong to I, M, C and R.
- **Where the catalogue lives.** `%APPDATA%\kestrel-ai\library\catalogue.db`.
  `app.catalogue.paths.catalogue_root(data_dir)` is the only function that knows the folder.
- **Failure contract.** A catalogue that fails to open is logged; the app starts;
  `app.state.catalogue = None`; catalogue endpoints answer `503 catalogue_unavailable`; projects
  render from their `project_type` snapshots (decision F2).
- **Error codes (spec §15, exact):** `type_exists` 409 (with the existing `type_id`),
  `severity_in_use` 409 (`{level, projects}`), `not_a_defect` 422, `invalid_transition` 409,
  `finding_would_be_deleted` 409, `attachment_invalid` 422 (with `reason`), `hotkey_conflict` 409,
  `class_in_use` 409, `catalogue_unavailable` 503. BC adds `unknown_type` 422, `severity_unknown`
  422, `severity_scale_invalid` 409, `type_name_blank` 409, `invalid_geometry` 422,
  `annotation_has_finding` 409, `annotation_not_reviewed` 409, `anchor_immutable` 422,
  `comment_blank` 409.
- **Finding numbers.** `F-` plus at least four digits (`F-0042`, `F-12345`). Allocated inside the
  create transaction, never reused after a delete (spec §8.1).
- **Limits.** Findings list `limit` ≤ 500; bulk `ids` ≤ 1000; comment `text` ≤ 4000; attachments
  JPEG, PNG or WebP, ≤ 50 MB; finding thumbnail 160×120; attachment thumbnail 256 px; the severity
  scale holds 1–9 contiguous levels (keys 1–9 are the severity keys, spec §5.6).
- **Severity defaults** (seeded once): 1 Minor `#3fb68e`, 2 Moderate `#e2bf2e`, 3 Major `#ff9c3a`,
  4 Critical `#ff5a4f`.
- **Events.** `findings.changed` payload `{ids}` (≤ 100) or `{all: true}`; `catalogue.changed`
  payload `{type_ids}` or `{severity: true}`, with `project_id: "library"` (the contract's
  `Event.project_id` is a non-null string).
- **Hot paths are bounded.** Nothing loads a project's boxes, images or findings into memory; the
  backfill pages 1000 boxes per transaction.
- **Lint.** `ruff` runs with `line-length = 110` and rules `E, F, I, B, UP` (`backend/pyproject.toml`).
  Every task runs `ruff format` first, then `ruff check`; a string or comment that `ruff check` still
  reports as too long (E501) is wrapped by hand.
- **Stage by path, never `git add -A`.** Commit identity is pinned in the worktree. Every commit
  message ends with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Never run the tests or a dev backend against your real `%APPDATA%`.** Tests point `data_dir` at
  `tmp_path` (`conftest.py::settings`). `0010` drops a column, and MG's copy-first backup (spec
  §11.2) lands after BC: do not open real project folders with a build of this branch.

## Review Focus

1. **Deleting images in bulk that carry defect findings** (Images tab, "Delete selected"). The
   existing `images.bulk_delete` removes boxes with one SQL `DELETE`, bypassing `delete_box`.
   Expected: the findings go with their images, the counts drop, and their attachments move to the
   trash; a future box delete that forgets the hook fails loudly (the finding's `annotation_id`
   foreign key has no `ON DELETE`) instead of leaving counts wrong. Pinned in Task 11
   (`test_bulk_image_delete_takes_the_findings_along`, `test_an_unhooked_box_delete_fails_loudly`).
2. **Deleting the newest finding, then creating one.** `max(number) + 1` would hand out the deleted
   number again, and a report that cited `F-0042` would now point at a different defect. Expected:
   numbers are never reused. Pinned in Task 7 (`test_numbers_are_never_reused_after_a_delete`).
3. **Undoing an accept (unreview) or rejecting an accepted defect box that already became a
   finding, with comments and a photo.** Expected: the finding disappears with the decision (the box
   is no longer ground truth), its photos are recoverable from `findings/_trash/` for 30 days, and
   accepting again creates a fresh finding with a new number. Pinned in Task 11
   (`test_unreviewing_an_accepted_defect_removes_its_finding`).
4. **A catalogue that cannot open** (corrupt `catalogue.db`, or a project copied from another
   machine whose types are unknown here). Expected: projects list and open, their classes render
   from the snapshot, findings on a snapshot type can still be created and graded; only paths that
   need a new catalogue type answer 503. Pinned in Task 5
   (`test_a_project_renders_from_its_snapshot_without_the_catalogue`) and Task 7
   (`test_findings_work_on_snapshot_types_without_the_catalogue`).
5. **Filtering and paging the Findings tab while findings arrive**, with a search text such as
   `100%`, `ZG_04` or `F-0012`. Expected: wildcards match literally, a number matches its finding
   (and notes that contain it), and a page boundary never duplicates or skips a finding when a new
   one sorts before it. Pinned in Task 8 (`test_like_wildcards_match_literally`,
   `test_paging_is_stable_while_findings_arrive`).

---

## File map

| File | Task | Responsibility |
| --- | --- | --- |
| `backend/app/catalogue/__init__.py` | 1 | package docstring |
| `backend/app/catalogue/paths.py` | 1 | `catalogue_root`, `DB_NAME` |
| `backend/app/catalogue/db.py` | 1 | `CatalogueBase`, `CatalogueType`, `SeverityLevel`, `CatalogueMeta` |
| `backend/app/catalogue/migrations/{alembic.ini,env.py,script.py.mako}` | 1 | the catalogue's own Alembic history |
| `backend/app/catalogue/migrations/versions/0001_catalogue.py` | 1 | revision `0001` |
| `backend/app/catalogue/handle.py` | 1 | `CatalogueHandle`, `open_catalogue`, `get_catalogue`, seeding |
| `backend/app/catalogue/names.py` | 2 | `normalise_name`, `normalise_hotkey` |
| `backend/app/catalogue/service.py` | 2 | types, `resolve_types`, `find_by_names`, `ensure_types`, the scale, meta |
| `backend/app/catalogue/schemas.py` | 4 | Pydantic shapes of C0's catalogue schemas |
| `backend/app/catalogue/usage.py` | 4 | `projects_using_level` (severity_in_use) |
| `backend/app/catalogue/router.py` | 4, 5, 12 | `/catalogue/types…`, `/catalogue/severity` |
| `backend/app/catalogue/project_types.py` | 5 | the project type list and its snapshots |
| `backend/app/catalogue/project_router.py` | 5 | `PUT /projects/{id}/types` |
| `backend/app/db/models.py` | 3, 5 | the `0010` ORM classes; `Project.classes` derived |
| `backend/app/db/migrations/versions/0010_foundation.py` | 3 | revision `0010` |
| `backend/app/findings/{__init__,events,numbers,counts,activity}.py` | 6 | the write plumbing |
| `backend/app/findings/{anchors,service}.py` | 7 | create, patch, delete, transitions |
| `backend/app/findings/query.py` | 8 | list, filters, keyset, bulk, summary, search |
| `backend/app/findings/{schemas,router,jobs}.py` | 9 | the HTTP API, `findings_recount` |
| `backend/app/findings/{trash,comments,attachments,thumbnails}.py` | 10 | files, thread, crops |
| `backend/app/findings/annotations.py` | 11 | the box ↔ finding hooks |
| `backend/app/findings/backfill.py` | 12 | `findings_from_annotations`, `findings_backfill` job |
| `backend/app/overview/{__init__,service,schemas,router}.py` | 13 | `GET /projects/{id}/overview`, `project_summary` |
| `backend/app/datasets/boxes.py` | 11 | hook calls; `*_in_session` helpers |
| `backend/app/datasets/images.py` | 11 | the bulk-delete hook (one call) |
| `backend/app/datasets/router.py` | 11 | `confirm_finding_delete` on `PATCH /boxes/{id}` |
| `backend/app/detect/class_maps.py` | 5 | `append_classes` writes through the catalogue |
| `backend/app/projects/{service,router,schemas}.py` | 5, 13 | `create` writes types; `/classes` route gone; `ClassDef` fields; `summary` |
| `backend/app/jobs/runner.py` | 1 | `self.catalogue = None` |
| `backend/app/main.py` | 1, 5, 9, 10 | `open_catalogue`; three `project_opened` steps |
| `backend/app/api.py` | 4, 5, 9, 13 | router includes |
| `backend/tests/project_factory.py` | 5 | BK's helper, now through catalogue types |
| `backend/tests/findings_helpers.py` | 5, 7 | shared test helpers |
| `backend/tests/test_catalogue_*.py`, `test_migration_0010.py`, `test_project_types.py`, `test_findings_*.py`, `test_overview.py` | 1–13 | new tests |
| `backend/tests/test_contract.py`, `test_exports_csv.py`, `test_projects.py` | 5, 9 | ported |
| `vault/decisions/2026-09-26-project-classes-derive-from-project-types.md` | 14 | ADR |

## Public interfaces other units consume

These names are fixed by this plan. A task's implementer sees only its task; the names are repeated
in each task's **Interfaces** block.

```python
# app/catalogue/paths.py
def catalogue_root(data_dir: Path) -> Path: ...                  # data_dir / "library"
DB_NAME = "catalogue.db"

# app/catalogue/handle.py
class CatalogueHandle:                                           # .folder, .engine, .session()
    ...
def open_catalogue(data_dir: Path) -> CatalogueHandle: ...
open_catalogue_db = open_catalogue                               # the name MG's plan uses
def get_catalogue(request: Request) -> CatalogueHandle: ...     # FastAPI dependency; 503 when None
def catalogue_unavailable() -> AppError: ...

# app/catalogue/names.py
def normalise_name(name: str) -> str: ...                        # casefold, trim, _/- -> space, collapse

# app/catalogue/service.py
@dataclass(frozen=True)
class CatalogueTypeRef:
    id: str; name: str; colour: str; kind: str                   # kind: "defect" | "object"
    default_severity: int | None; hotkey: str | None; group: str | None
    archived: bool; origin: str                                  # origin: "user" | "migrated"
@dataclass(frozen=True)
class SeverityLevelRef:
    level: int; name: str; colour: str
NEEDS_CLASSIFICATION = "needs_classification"
from app.catalogue.names import normalise_name                 # re-exported: service.normalise_name
def resolve_types(cat: CatalogueHandle, type_ids: Iterable[str]) -> dict[str, CatalogueTypeRef]: ...
    # by id; an unknown id is left out (BM's CatalogueAdapter.resolve_types)
def find_by_names(cat, names: Sequence[str]) -> dict[str, CatalogueTypeRef]: ...
    # live types matched by normalise_name, keyed by each input name; unmatched names left out
def ensure_types(cat, names: Sequence[str], *, kind: str = "object", origin: str = "user",
                 colours: Mapping[str, str] | None = None,
                 hotkeys: Mapping[str, str | None] | None = None) -> dict[str, CatalogueTypeRef]: ...
    # find_by_names, creating each unmatched name (Setup agent; MG step 1 with origin="migrated")
def add_project_types(handle, cat, type_ids: Sequence[str]) -> list[str]: ...
    # BM's run start: append to a project's type list in its own transaction
def create_type(cat, *, name: str, colour: str | None = None, kind: str = "object",
                default_severity: int | None = None, hotkey: str | None = None,
                group: str | None = None, origin: str = "user") -> CatalogueTypeRef: ...
def get_type(cat, type_id: str) -> CatalogueTypeRef: ...         # 404 not_found
def patch_type(cat, type_id: str, fields: Mapping[str, Any]) -> tuple[CatalogueTypeRef, bool]: ...
def list_types(cat, *, q=None, kind=None, origin=None, include_archived=False, cursor=None,
               limit=None) -> tuple[list[CatalogueTypeRef], str | None]: ...
def get_scale(cat) -> list[SeverityLevelRef]: ...
def scale_levels(cat: CatalogueHandle | None) -> list[int]: ...  # D4's [1, 2, 3, 4] without a catalogue
def put_scale(cat, levels: Sequence[Mapping[str, Any]],
              level_in_use: Callable[[int], list[str]]) -> list[SeverityLevelRef]: ...
def get_meta(cat, key: str, default: Any = None) -> Any: ...
def set_meta(cat, key: str, value: Any) -> None: ...

# app/catalogue/project_types.py  (all take the caller's project session)
def project_classes(s: Session) -> list[dict]: ...               # ClassDef dicts, list order
def lookup_types(cat, type_ids: Sequence[str]) -> dict[str, CatalogueTypeRef]: ...
def set_types(s, cat, type_ids: Sequence[str], hotkeys: Mapping[str, str | None] | None = None) -> None: ...
def add_types(s, cat, type_ids: Sequence[str]) -> list[str]: ...  # appends; returns the added ids
def refresh_snapshots(s, cat, type_ids: Iterable[str] | None = None) -> int: ...
def refresh_handle(handle) -> int: ...
def append_by_names(s, cat, names: Sequence[str]) -> dict[str, str]: ...   # name -> type id
def check_removed_types_unused(s, type_ids: Iterable[str]) -> None: ...     # 409 class_in_use

# app/findings/anchors.py
@dataclass
class AnchorIn:
    kind: str                      # "image" | "map" | "cloud"
    image_id: str | None = None; annotation_id: str | None = None; box: dict | None = None
    map_id: str | None = None; geometry: dict | None = None
    cloud_id: str | None = None; x: float | None = None; y: float | None = None
    z: float | None = None; uncertainty_m: float | None = None

# app/findings/service.py
UNSET: Any
def create_in_session(s: Session, *, project_id: str, catalogue: CatalogueHandle | None,
                      type_id: str, anchor: AnchorIn, severity: int | None = UNSET, note: str = "",
                      status: str = "open", created_by: str = "human",
                      confidence: float | None = None, lon: float | None = None,
                      lat: float | None = None, created_at: datetime | None = None,
                      number: int | None = None, record_activity: bool = True) -> Finding: ...
def patch_in_session(s, *, project_id: str, catalogue, finding_id: str, fields: Mapping[str, Any]) -> Finding: ...
def delete_in_session(s, *, project_id: str, finding_id: str, delete_annotation: bool = True) -> str: ...
def create_finding(handle, **kw) -> Finding: ...                 # own session; image `box` geometry too
def patch_finding(handle, finding_id: str, fields: Mapping[str, Any]) -> Finding: ...
def delete_finding(handle, finding_id: str) -> None: ...
def delete_for_anchor(s, *, project_id: str, anchor_kind: str, target_id: str) -> list[str]: ...  # M/C deleting a map/cloud

# app/findings/backfill.py
def findings_from_annotations(handle, type_ids: Sequence[str] | None = None, *, batch: int = 1000,
                              progress: Callable[[int, int], None] | None = None,
                              check_cancelled: Callable[[], None] | None = None) -> int: ...

# app/findings/counts.py
def change(s, old: Key | None, new: Key | None) -> None: ...     # Key = (status, severity, type_id)
def recount(s, day: date | None = None) -> dict: ...
def today() -> date: ...

# app/findings/activity.py
def record(s, kind: str, subject_id: str | None, summary: str, payload: dict | None = None) -> None: ...

# app/findings/events.py
def mark_changed(s: Session, project_id: str, ids: Iterable[str]) -> None: ...

# app/findings/numbers.py
def format_number(n: int) -> str: ...                            # 42 -> "F-0042"
def parse_number(text: str) -> int | None: ...

# app/findings/query.py
def search_findings(s, q: str, limit: int = 8) -> list[Finding]: ...

# app/overview/service.py
BANNER_PROVIDERS: list[Callable[[ProjectHandle], list[dict]]]    # MG appends its migration banner
def project_summary(s, top_level: int) -> dict: ...
```

---

### Task 1: Catalogue storage, handle and startup

**Files:**
- Create: `backend/app/catalogue/__init__.py`, `backend/app/catalogue/paths.py`, `backend/app/catalogue/db.py`, `backend/app/catalogue/handle.py`
- Create: `backend/app/catalogue/migrations/alembic.ini`, `backend/app/catalogue/migrations/env.py`, `backend/app/catalogue/migrations/script.py.mako`, `backend/app/catalogue/migrations/versions/0001_catalogue.py`
- Modify: `backend/app/main.py` (add `open_catalogue`, call it in `lifespan`, dispose on shutdown)
- Modify: `backend/app/jobs/runner.py` (`self.catalogue = None` in `JobRunner.__init__`)
- Test: `backend/tests/test_catalogue_db.py`

**Interfaces:**
- Consumes: `app.db.base.UTCDateTime, new_id, utcnow`; `app.db.session.make_session_factory`; `app.errors.AppError`.
- Produces: `catalogue_root(data_dir) -> Path`, `DB_NAME`; `CatalogueBase`, `CatalogueType`, `SeverityLevel`, `CatalogueMeta`; `CatalogueHandle(folder, engine)` with `.session()`; `open_catalogue(data_dir) -> CatalogueHandle` and its alias `open_catalogue_db` (MG's name); `get_catalogue(request) -> CatalogueHandle`; `catalogue_unavailable() -> AppError`; `DEFAULT_SCALE`; `MIGRATIONS`; `app.state.catalogue`, `app.state.catalogue_error`, `app.state.jobs.catalogue`, `app.state.projects.catalogue`.

- [ ] **Step 1: Preflight (no code)**

From `E:\Dev\Yolo\app`:
```powershell
git log --oneline main -20
scripts\start-task.ps1 f-bc
cd E:\Dev\Yolo\app\.claude\worktrees\f-bc
git branch --show-current
Select-String -Path contract\openapi.yaml -Pattern "^  /catalogue/|^  /projects/\{projectId\}/(findings|types|overview|activity)"
Select-String -Path contract\openapi.yaml -Pattern "operationId: .*(Finding|Catalogue|Severity|Activity|Overview|ProjectTypes|Backfill)"
Select-String -Path backend\tests\test_contract.py -Pattern "EXPECTED_STUBS|RETIRING|BACKEND_PENDING|REFUSES_VALID_DATA|classes|summary"
Select-String -Path backend\app\*.py,backend\app\*\*.py -Pattern "add_stubs|register_finding_search|def open_recent"
```
Expected: C0's merge commit in the log; branch `task/f-bc`; the catalogue and findings paths
printed. If BK's merge commit is also in the log, `register_finding_search` and `open_recent` are
found (BK); if not, they are absent now and Task 5 Step 0 waits for BK and rebases. Then open
`contract/openapi.yaml` and fill this table in your task notes. Every later task uses the right-hand
column; where C0 differs, the **contract wins** and you rename in code and tests alike.

| What | This plan assumes | C0's actual name |
| --- | --- | --- |
| type list | `GET /catalogue/types?q&kind&origin&include_archived&limit&cursor` → `{items: CatalogueType[], next_cursor}` | |
| type create / patch | `POST /catalogue/types` (201 `CatalogueType`), `PATCH /catalogue/types/{typeId}` (200 `CatalogueType` + `backfill_candidates: bool`) | |
| backfill | `POST /catalogue/types/{typeId}/backfill` → 202 `JobRef` | |
| scale | `GET /catalogue/severity`, `PUT /catalogue/severity` with `{levels: SeverityLevel[]}` | |
| project types | `PUT /projects/{projectId}/types` `{type_ids, hotkeys?}` → `Project` | |
| findings | the §8.3 table; list query arrays `status`, `severity` (`1`–`9` or `none`), `type_id`, `anchor_kind`; `image_id` (I's addition) | |
| `Finding` | `{id, number, type_id, severity, status, note, created_by, confidence, anchor, lon, lat, data_type, data_id, created_at, updated_at, reviewed_at, closed_at}`; detail adds `attachment_count`, `comment_count` | |
| `FindingAnchor` | oneOf image `{kind, image_id, annotation_id}` (create may send `box` instead of `annotation_id`), map `{kind, map_id, geometry}`, cloud `{kind, cloud_id, x, y, z, uncertainty_m}` | |
| `FindingSummary` | `{by_status: {open, reviewed, closed}, open_by_severity: {"<level>": n}, open_no_severity, by_type: [{type_id, n}], trend: [{day, open, closed, open_by_severity: {"<level>": n}}]}` (S1's plan assumes the same) | |
| `ProjectOverview` | `{findings: FindingSummary, data: {image_sets, images, maps, elevations, point_clouds, drawings}, latest_volume: {measurement_id, name, net_m3, previous_net_m3} \| null, hero_map_id, banners: [{kind, tone: info \| warn \| danger, message, action}]}` (S1's plan assumes the same) | |
| `ProjectSummary` | `{image_count, maps, point_clouds, elevations, open_findings, open_top_severity, cover: {kind, id} \| null}` | |
| box patch | `PATCH /projects/{projectId}/boxes/{boxId}?confirm_finding_delete=true` | |
| operationIds | `listCatalogueTypes`, `createCatalogueType`, `getCatalogueType`, `patchCatalogueType`, `backfillCatalogueType`, `getSeverityScale`, `putSeverityScale`, `putProjectTypes`, `listFindings`, `createFinding`, `getFinding`, `patchFinding`, `deleteFinding`, `bulkUpdateFindings`, `getFindingSummary`, `getFindingThumbnail`, `recountFindings`, `listFindingComments`, `createFindingComment`, `patchFindingComment`, `deleteFindingComment`, `listFindingAttachments`, `addFindingAttachment`, `deleteFindingAttachment`, `getFindingAttachmentFile`, `getFindingAttachmentThumbnail`, `listActivity`, `getProjectOverview`, `getOperatorSettings`, `putOperatorSettings` (`GET/PUT /settings/operator`, Task 10) | |

Record also: (a) any `add_stubs` tuples and `EXPECTED_STUBS` entries C0 added for BC's operations
(each task that builds an operation deletes its stub and entry); (b) C0's `RETIRING` entry for
`updateClasses` (`PUT /projects/{id}/classes`, deprecated, `x-retire-with: F-S1`): Task 5 deletes the
route and **keeps** the entry, because the path stays in the contract until S1 deletes it; (c) whether `ProjectOut` already declares
`summary` (Task 13 fills it).

Baseline:
```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-bc\backend
$PY = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
& $PY -m pytest -q -x -p no:cacheprovider
```
Expected: the suite passes, except `tests/test_contract.py` failures that name BC's operations
(unrouted or stubbed). Note that list; it must be empty at Task 14.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_catalogue_db.py`:
```python
"""catalogue.db (spec 2026-09-26-foundation section 7.1): its own file next to library.db, its own
Alembic history at 0001, D4's severity scale seeded once, and live names and hotkeys unique in the
database itself, not only in Python."""

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import CatalogueType, SeverityLevel
from app.catalogue.handle import MIGRATIONS, open_catalogue
from app.catalogue.paths import catalogue_root

AUTH = {"Authorization": "Bearer test-token"}


@pytest.fixture
def cat(tmp_path):
    handle = open_catalogue(tmp_path)
    yield handle
    handle.engine.dispose()


def _type(name: str, key: str, **kw) -> CatalogueType:
    return CatalogueType(
        name=name, name_key=key, colour=kw.pop("colour", "#ff0000"), kind=kw.pop("kind", "defect"), **kw
    )


def test_the_catalogue_lives_next_to_library_db(tmp_path):
    assert catalogue_root(tmp_path) == tmp_path / "library"


def test_first_open_creates_the_file_and_seeds_the_default_scale(cat, tmp_path):
    assert (tmp_path / "library" / "catalogue.db").is_file()
    with cat.session() as s:
        rows = s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()
        levels = [(r.level, r.name, r.colour) for r in rows]
    assert levels == [
        (1, "Minor", "#3fb68e"),
        (2, "Moderate", "#e2bf2e"),
        (3, "Major", "#ff9c3a"),
        (4, "Critical", "#ff5a4f"),
    ]


def test_reopening_keeps_an_edited_scale(tmp_path):
    first = open_catalogue(tmp_path)
    with first.session() as s:
        s.get(SeverityLevel, 4).name = "Urgent"
    first.engine.dispose()
    again = open_catalogue(tmp_path)
    try:
        with again.session() as s:
            names = [r.name for r in s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()]
    finally:
        again.engine.dispose()
    assert names == ["Minor", "Moderate", "Major", "Urgent"]


def test_live_names_are_unique_but_an_archived_name_may_return(cat):
    with cat.session() as s:
        s.add(_type("Crack", "crack", archived=True))
        s.add(_type("crack", "crack"))
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("CRACK", "crack"))
        s.flush()


def test_live_hotkeys_are_unique(cat):
    with cat.session() as s:
        s.add(_type("Crack", "crack", hotkey="c"))
        s.add(_type("Spall", "spall", hotkey="c", archived=True))
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("Corrosion", "corrosion", hotkey="c"))
        s.flush()


def test_kind_is_defect_or_object(cat):
    with pytest.raises(IntegrityError), cat.session() as s:
        s.add(_type("Thing", "thing", kind="thing"))
        s.flush()


def test_the_catalogue_history_has_one_head_at_0001():
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    assert ScriptDirectory.from_config(cfg).get_heads() == ["0001"]


def test_the_app_opens_the_catalogue(client):
    state = client.app.state
    assert state.catalogue is not None and state.catalogue_error is None
    assert state.jobs.catalogue is state.catalogue
    assert state.projects.catalogue is state.catalogue


def test_the_app_starts_when_the_catalogue_cannot_open(app, monkeypatch):
    def broken(data_dir):
        raise OSError("disk says no")

    monkeypatch.setattr("app.catalogue.handle.open_catalogue", broken)
    with TestClient(app, headers=AUTH) as c:
        assert c.get("/api/v1/health").status_code == 200
        assert app.state.catalogue is None
        assert "disk says no" in app.state.catalogue_error
        assert app.state.jobs.catalogue is None
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_catalogue_db.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.catalogue'`.

- [ ] **Step 4: Write the package**

`backend/app/catalogue/__init__.py`:
```python
"""The app-wide catalogue: defect and object types and the severity scale (spec
2026-09-26-foundation section 7). Its database, `catalogue.db`, is also where R keeps report
templates (catalogue revision 0002)."""
```

`backend/app/catalogue/paths.py`:
```python
"""Where the app-wide catalogue lives. The only place that knows this path (spec F1)."""

from pathlib import Path

DB_NAME = "catalogue.db"


def catalogue_root(data_dir: Path) -> Path:
    """`%APPDATA%/kestrel-ai/library`: next to library.db, its own file and Alembic history, so a
    corrupt library cannot take the catalogue down, and the reverse."""
    return Path(data_dir) / "library"
```

`backend/app/catalogue/db.py`:
```python
"""The catalogue database (`catalogue.db`): catalogue types, the severity scale and a key/value
meta table (spec 2026-09-26-foundation section 7.1)."""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, CheckConstraint, Index, Integer, String, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db.base import UTCDateTime, new_id, utcnow


class CatalogueBase(DeclarativeBase):
    pass


class CatalogueType(CatalogueBase):
    __tablename__ = "catalogue_type"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String)
    # normalise_name(name). Not in the spec's column list: the partial unique index below needs a
    # stored key, so "dump_truck" and "Dump truck" collide in the database, not only in Python.
    name_key: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))  # "#rrggbb", lower case
    kind: Mapped[str] = mapped_column(String)  # defect | object
    default_severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hotkey: Mapped[str | None] = mapped_column(String(1), nullable=True)  # 1-9 or a-z
    group: Mapped[str | None] = mapped_column(String, nullable=True)  # "Concrete defects"
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    origin: Mapped[str] = mapped_column(String, default="user")  # user | migrated
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    __table_args__ = (
        CheckConstraint("kind IN ('defect', 'object')", name="ck_catalogue_type_kind"),
        CheckConstraint("origin IN ('user', 'migrated')", name="ck_catalogue_type_origin"),
        Index("ux_catalogue_type_live_name", "name_key", unique=True, sqlite_where=text("archived = 0")),
        Index(
            "ux_catalogue_type_live_hotkey",
            "hotkey",
            unique=True,
            sqlite_where=text("archived = 0 AND hotkey IS NOT NULL"),
        ),
    )


class SeverityLevel(CatalogueBase):
    __tablename__ = "severity_level"
    level: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))


class CatalogueMeta(CatalogueBase):
    """`needs_classification` (set by MG after a migration merged types), `seeded`."""

    __tablename__ = "catalogue_meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
```

Copy the library's Alembic scaffolding, then edit `env.py`:
```powershell
New-Item -ItemType Directory -Force app\catalogue\migrations\versions | Out-Null
Copy-Item app\library\migrations\alembic.ini app\catalogue\migrations\alembic.ini
Copy-Item app\library\migrations\script.py.mako app\catalogue\migrations\script.py.mako
```

`backend/app/catalogue/migrations/env.py`:
```python
import sys
from pathlib import Path

from alembic import context

_ROOT = str(Path(__file__).resolve().parents[3])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from app.catalogue.db import CatalogueBase  # noqa: E402

config = context.config
target_metadata = CatalogueBase.metadata


def run_migrations_online() -> None:
    """`open_catalogue` always hands over its own connection; there is no offline mode."""
    connection = config.attributes["connection"]
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


run_migrations_online()
```

`backend/app/catalogue/migrations/versions/0001_catalogue.py`:
```python
"""catalogue: catalogue_type, severity_level, catalogue_meta

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "catalogue_type",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("name_key", sa.String(), nullable=False),
        sa.Column("colour", sa.String(length=7), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("default_severity", sa.Integer(), nullable=True),
        sa.Column("hotkey", sa.String(length=1), nullable=True),
        sa.Column("group", sa.String(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("origin", sa.String(), nullable=False, server_default="user"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("kind IN ('defect', 'object')", name="ck_catalogue_type_kind"),
        sa.CheckConstraint("origin IN ('user', 'migrated')", name="ck_catalogue_type_origin"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ux_catalogue_type_live_name",
        "catalogue_type",
        ["name_key"],
        unique=True,
        sqlite_where=sa.text("archived = 0"),
    )
    op.create_index(
        "ux_catalogue_type_live_hotkey",
        "catalogue_type",
        ["hotkey"],
        unique=True,
        sqlite_where=sa.text("archived = 0 AND hotkey IS NOT NULL"),
    )
    op.create_table(
        "severity_level",
        sa.Column("level", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("colour", sa.String(length=7), nullable=False),
        sa.PrimaryKeyConstraint("level"),
    )
    op.create_table(
        "catalogue_meta",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("key"),
    )


def downgrade() -> None:
    op.drop_table("catalogue_meta")
    op.drop_table("severity_level")
    op.drop_index("ux_catalogue_type_live_hotkey", table_name="catalogue_type")
    op.drop_index("ux_catalogue_type_live_name", table_name="catalogue_type")
    op.drop_table("catalogue_type")
```

`backend/app/catalogue/handle.py`:
```python
"""The catalogue handle, shaped like the library handle: a folder, an engine and `session()`."""

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import Request
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app.catalogue.db import CatalogueMeta, SeverityLevel
from app.catalogue.paths import DB_NAME, catalogue_root
from app.db.session import make_session_factory
from app.errors import AppError

MIGRATIONS = Path(__file__).parent / "migrations"
CATALOGUE_UNAVAILABLE = "The catalogue could not be opened."
SEEDED = "seeded"
# D4's default scale (spec section 4.1, "Severity defaults").
DEFAULT_SCALE = (
    (1, "Minor", "#3fb68e"),
    (2, "Moderate", "#e2bf2e"),
    (3, "Major", "#ff9c3a"),
    (4, "Critical", "#ff5a4f"),
)


class CatalogueHandle:
    def __init__(self, folder: Path, engine):
        self.folder, self.engine = folder, engine
        self._factory = make_session_factory(engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        s = self._factory()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()


def _db_url(folder: Path) -> str:
    return f"sqlite:///{(folder / DB_NAME).as_posix()}"


def seed(handle: CatalogueHandle) -> None:
    """First open only: D4's four levels. The marker keeps an operator's later edits (a removed top
    level, say) from being seeded back on the next start."""
    with handle.session() as s:
        if s.get(CatalogueMeta, SEEDED) is not None:
            return
        if s.execute(select(func.count()).select_from(SeverityLevel)).scalar_one() == 0:
            s.add_all(SeverityLevel(level=lv, name=n, colour=c) for lv, n, c in DEFAULT_SCALE)
        s.add(CatalogueMeta(key=SEEDED, value=True))


def open_catalogue(data_dir: Path) -> CatalogueHandle:
    """Create the folder if needed, bring `catalogue.db` to its newest schema and seed it."""
    root = catalogue_root(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    engine = create_engine(_db_url(root), future=True, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    cfg.set_main_option("sqlalchemy.url", _db_url(root))
    try:
        with engine.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")
        handle = CatalogueHandle(root, engine)
        seed(handle)
    except Exception:
        engine.dispose()
        raise
    return handle


# The name MG's plan uses (dry run and migration steps open the catalogue directly).
open_catalogue_db = open_catalogue


def catalogue_unavailable() -> AppError:
    return AppError("catalogue_unavailable", CATALOGUE_UNAVAILABLE, 503)


def get_catalogue(request: Request) -> CatalogueHandle:
    """FastAPI dependency: the open catalogue, or 503 `catalogue_unavailable` when startup failed."""
    cat = getattr(request.app.state, "catalogue", None)
    if cat is None:
        raise catalogue_unavailable()
    return cat
```

- [ ] **Step 5: Wire startup**

In `backend/app/jobs/runner.py`, `JobRunner.__init__`, after the `self.library = None` line add:
```python
        # The app-wide catalogue (a CatalogueHandle), wired in the lifespan like `library`; None when
        # it could not be opened. The findings backfill reads it from here.
        self.catalogue = None
```

In `backend/app/main.py`, add after `open_model_library`:
```python
def open_catalogue(app: FastAPI, settings: Settings) -> None:
    """Open the app-wide catalogue. A failure is logged and the app starts without it: catalogue
    endpoints then answer 503 `catalogue_unavailable`, and projects render from their type
    snapshots (spec 2026-09-26-foundation section 7.1 and decision F2)."""
    from app.catalogue import handle as catalogue_handle

    app.state.catalogue, app.state.catalogue_error = None, None
    try:
        app.state.catalogue = catalogue_handle.open_catalogue(settings.data_dir)
    except Exception as e:
        logging.getLogger(__name__).exception("the catalogue could not be opened")
        app.state.catalogue_error = f"{type(e).__name__}: {e}"
    app.state.jobs.catalogue = app.state.catalogue
    app.state.projects.catalogue = app.state.catalogue
```
In `lifespan`, directly after `open_model_library(app, settings)` add `open_catalogue(app, settings)`.
In the shutdown half, after the library dispose, add:
```python
        if app.state.catalogue is not None:
            app.state.catalogue.engine.dispose()
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_catalogue_db.py -v`
Expected: 9 passed.

- [ ] **Step 7: Lint and commit**

```powershell
& $PY -m ruff format app/catalogue app/main.py app/jobs/runner.py tests/test_catalogue_db.py
& $PY -m ruff check app/catalogue app/main.py app/jobs/runner.py tests/test_catalogue_db.py
cd ..
git add backend/app/catalogue/__init__.py backend/app/catalogue/paths.py backend/app/catalogue/db.py backend/app/catalogue/handle.py backend/app/catalogue/migrations/alembic.ini backend/app/catalogue/migrations/env.py backend/app/catalogue/migrations/script.py.mako backend/app/catalogue/migrations/versions/0001_catalogue.py backend/app/main.py backend/app/jobs/runner.py backend/tests/test_catalogue_db.py
git commit -m @'
feat(catalogue): catalogue.db with its own history, seeded scale, 503-safe startup

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 2: Catalogue service: `resolve_types`, `find_by_names`, `ensure_types`

**Files:**
- Create: `backend/app/catalogue/names.py`, `backend/app/catalogue/service.py`
- Test: `backend/tests/test_catalogue_service.py`

**Interfaces:**
- Consumes: Task 1's `CatalogueHandle`, `CatalogueType`, `SeverityLevel`, `CatalogueMeta`; `app.pagination.clamp_limit, decode_cursor, encode_cursor`.
- Produces: `normalise_name(name) -> str`; `normalise_hotkey(key) -> str | None`; `like_pattern(text) -> str` (`%text%` with `\`, `%`, `_` literal; used with `escape="\\"`); `CatalogueTypeRef`; `SeverityLevelRef`; `to_ref`; `create_type`, `get_type`, `resolve_types`, `find_by_names`, `ensure_types`, `add_project_types`, `patch_type`, `list_types`, `get_scale`, `scale_levels(cat | None) -> list[int]`, `put_scale`, `get_meta`, `set_meta`, `NEEDS_CLASSIFICATION`, `MAX_LEVELS = 9` (signatures in "Public interfaces" above).

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_catalogue_service.py`:
```python
"""Catalogue rules (spec 2026-09-26-foundation section 7.2): names match by normalise_name, types are
archived and never deleted, hotkeys are unique among live types, and the severity scale only grows
at the top or shrinks there when nothing uses the level."""

import pytest

from app.catalogue import service
from app.catalogue.handle import open_catalogue
from app.catalogue.names import normalise_name
from app.errors import AppError


@pytest.fixture
def cat(tmp_path):
    handle = open_catalogue(tmp_path)
    yield handle
    handle.engine.dispose()


def _refused(fn, *args, **kwargs) -> AppError:
    with pytest.raises(AppError) as e:
        fn(*args, **kwargs)
    return e.value


def _scale(cat) -> list[dict]:
    return [{"level": lv.level, "name": lv.name, "colour": lv.colour} for lv in service.get_scale(cat)]


@pytest.mark.parametrize(
    ("raw", "key"),
    [
        ("dump_truck", "dump truck"),
        ("  Dump   Truck ", "dump truck"),
        ("Dump-Truck", "dump truck"),
        ("DUMP__TRUCK", "dump truck"),
        ("Straße", "strasse"),
    ],
)
def test_normalise_name(raw, key):
    assert normalise_name(raw) == key


def test_a_name_that_normalises_to_an_existing_one_is_type_exists(cat):
    first = service.create_type(cat, name="dump_truck")
    e = _refused(service.create_type, cat, name="Dump truck")
    assert (e.code, e.status, e.details["type_id"]) == ("type_exists", 409, first.id)


def test_a_blank_name_is_refused(cat):
    e = _refused(service.create_type, cat, name="  _- ")
    assert (e.code, e.status) == ("type_name_blank", 409)


def test_an_archived_name_can_return_but_cannot_be_unarchived_into_a_clash(cat):
    old = service.create_type(cat, name="Crack", kind="defect")
    service.patch_type(cat, old.id, {"archived": True})
    new = service.create_type(cat, name="crack", kind="defect")
    assert new.id != old.id
    e = _refused(service.patch_type, cat, old.id, {"archived": False})
    assert (e.code, e.details["type_id"]) == ("type_exists", new.id)


def test_hotkeys_are_lower_case_and_unique_among_live_types(cat):
    crack = service.create_type(cat, name="Crack", kind="defect", hotkey="C")
    assert crack.hotkey == "c"
    e = _refused(service.create_type, cat, name="Corrosion", hotkey="c")
    assert (e.code, e.status, e.details["type_id"]) == ("hotkey_conflict", 409, crack.id)
    service.patch_type(cat, crack.id, {"archived": True})
    assert service.create_type(cat, name="Corrosion", hotkey="c").hotkey == "c"


def test_a_default_severity_must_be_on_the_scale(cat):
    e = _refused(service.create_type, cat, name="Crack", kind="defect", default_severity=7)
    assert (e.code, e.status) == ("severity_unknown", 422)
    assert service.create_type(cat, name="Crack", kind="defect", default_severity=4).default_severity == 4


def test_object_to_defect_offers_a_backfill_and_the_reverse_does_not(cat):
    t = service.create_type(cat, name="Pothole")
    ref, offer = service.patch_type(cat, t.id, {"kind": "defect"})
    assert (ref.kind, offer) == ("defect", True)
    ref, offer = service.patch_type(cat, t.id, {"kind": "object"})
    assert (ref.kind, offer) == ("object", False)


def test_patch_renames_recolours_and_regroups(cat):
    t = service.create_type(cat, name="Crack", kind="defect")
    ref, _ = service.patch_type(cat, t.id, {"name": "Hairline crack", "colour": "#AABBCC", "group": "Concrete"})
    assert (ref.name, ref.colour, ref.group) == ("Hairline crack", "#aabbcc", "Concrete")


def test_resolve_types_looks_types_up_by_id(cat):
    t = service.create_type(cat, name="Crack", kind="defect")
    assert service.resolve_types(cat, [t.id, "nope"]) == {t.id: t}


def test_find_by_names_matches_by_normalised_name(cat):
    truck = service.create_type(cat, name="Dump truck")
    got = service.find_by_names(cat, ["dump_truck", "DUMP-TRUCK", "crane"])
    assert got["dump_truck"].id == truck.id == got["DUMP-TRUCK"].id
    assert "crane" not in got
    assert service.normalise_name is normalise_name  # BM imports it from the service


def test_ensure_types_creates_each_missing_type_once(cat):
    service.create_type(cat, name="Crane", hotkey="1")
    got = service.ensure_types(
        cat,
        ["Excavator", "excavator", "Crane"],
        origin="migrated",
        colours={"Excavator": "#123456"},
        hotkeys={"Excavator": "1"},
    )
    ex = got["Excavator"]
    assert got["excavator"].id == ex.id
    assert (ex.origin, ex.kind, ex.colour, ex.hotkey) == ("migrated", "object", "#123456", None)
    assert got["Crane"].origin == "user"
    types, _ = service.list_types(cat)
    assert sorted(t.name for t in types) == ["Crane", "Excavator"]


def test_ensure_types_creates_a_live_type_beside_an_archived_one(cat):
    old = service.create_type(cat, name="Roller")
    service.patch_type(cat, old.id, {"archived": True})
    assert service.find_by_names(cat, ["roller"]) == {}
    got = service.ensure_types(cat, ["roller"])
    assert got["roller"].id != old.id and not got["roller"].archived
    assert service.find_by_names(cat, ["Roller"])["Roller"].id == got["roller"].id


def test_list_types_filters_and_pages(cat):
    for name, kind in [("Crack", "defect"), ("Crane", "object"), ("Dump truck", "object"), ("Spall", "defect")]:
        service.create_type(cat, name=name, kind=kind)
    gone = service.create_type(cat, name="Rust", kind="defect")
    service.patch_type(cat, gone.id, {"archived": True})
    first, cursor = service.list_types(cat, limit=2)
    second, end = service.list_types(cat, limit=2, cursor=cursor)
    assert [t.name for t in first + second] == ["Crack", "Crane", "Dump truck", "Spall"]
    assert cursor is not None and end is None
    assert [t.name for t in service.list_types(cat, kind="defect")[0]] == ["Crack", "Spall"]
    assert "Rust" in [t.name for t in service.list_types(cat, include_archived=True)[0]]
    assert [t.name for t in service.list_types(cat, q="truck")[0]] == ["Dump truck"]


def test_the_scale_takes_renames_recolours_and_a_new_top_level(cat):
    levels = _scale(cat)
    levels[0]["name"] = "Cosmetic"
    levels.append({"level": 5, "name": "Severe", "colour": "#990000"})
    out = service.put_scale(cat, levels, level_in_use=lambda level: [])
    assert [(lv.level, lv.name) for lv in out] == [
        (1, "Cosmetic"),
        (2, "Moderate"),
        (3, "Major"),
        (4, "Critical"),
        (5, "Severe"),
    ]


def test_removing_the_top_level_is_refused_while_a_project_uses_it(cat):
    e = _refused(service.put_scale, cat, _scale(cat)[:3], level_in_use=lambda lv: ["Bridge A"] if lv == 4 else [])
    assert (e.code, e.status, e.details) == ("severity_in_use", 409, {"level": 4, "projects": ["Bridge A"]})
    assert len(service.get_scale(cat)) == 4


def test_removing_an_unused_top_level_clears_defaults_that_pointed_at_it(cat):
    t = service.create_type(cat, name="Crack", kind="defect", default_severity=4)
    service.put_scale(cat, _scale(cat)[:3], level_in_use=lambda level: [])
    assert service.get_type(cat, t.id).default_severity is None


@pytest.mark.parametrize("numbers", [[1, 2, 4], [2, 3], [], list(range(1, 11))])
def test_the_scale_runs_1_to_n_without_gaps(cat, numbers):
    levels = [{"level": n, "name": f"L{n}", "colour": "#000000"} for n in numbers]
    e = _refused(service.put_scale, cat, levels, level_in_use=lambda level: [])
    assert (e.code, e.status) == ("severity_scale_invalid", 409)


def test_scale_levels_fall_back_to_the_default_scale(cat):
    assert service.scale_levels(cat) == [1, 2, 3, 4]
    assert service.scale_levels(None) == [1, 2, 3, 4]


def test_meta_round_trips(cat):
    assert service.get_meta(cat, service.NEEDS_CLASSIFICATION) is None
    service.set_meta(cat, service.NEEDS_CLASSIFICATION, {"count": 12})
    assert service.get_meta(cat, service.NEEDS_CLASSIFICATION) == {"count": 12}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_catalogue_service.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.catalogue.names'`.

- [ ] **Step 3: Implement**

`backend/app/catalogue/names.py`:
```python
"""Name and hotkey normalisation for catalogue types (spec 2026-09-26-foundation section 7.1)."""

import re

from app.errors import AppError

_SEPARATORS = re.compile(r"[_\-]+")
_SPACES = re.compile(r"\s+")
_HOTKEY = re.compile(r"^[1-9a-z]$")


def normalise_name(name: str) -> str:
    """Casefold, trim, `_` and `-` become spaces, runs of spaces collapse: "dump_truck" and
    "Dump truck" are one type."""
    return _SPACES.sub(" ", _SEPARATORS.sub(" ", (name or "").casefold())).strip()


def like_pattern(text: str) -> str:
    """`text` as a LIKE pattern matched anywhere, with a backslash, `%` and `_` taken literally. Use it with
    `escape="\\"`. The same rule as BK's `app.data_items.search.like_pattern`; a copy here because
    importing `app.data_items` from the catalogue would close an import cycle through
    `app.projects.service`."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def normalise_hotkey(key: str | None) -> str | None:
    """`1`-`9` or a letter, stored lower case; None or "" means no hotkey."""
    if key is None or key == "":
        return None
    k = key.strip().lower()
    if not _HOTKEY.match(k):
        raise AppError("hotkey_invalid", f"{key!r} is not a hotkey; use 1-9 or a letter.", 422)
    return k
```

`backend/app/catalogue/service.py`:
```python
"""Catalogue types and the severity scale (spec 2026-09-26-foundation sections 7.1-7.2).

The public entries other units call (BM's `CatalogueAdapter`, MG's catalogue merge, the project type
list): `resolve_types` looks types up by id; `find_by_names` and `ensure_types` match names by
`normalise_name` (`normalise_name` is re-exported from here); `add_project_types` appends to a
project's list.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.exc import IntegrityError

from app.catalogue.db import CatalogueMeta, CatalogueType, SeverityLevel
from app.catalogue.handle import DEFAULT_SCALE, CatalogueHandle
from app.catalogue.names import like_pattern, normalise_hotkey, normalise_name
from app.errors import AppError, not_found
from app.pagination import clamp_limit, decode_cursor, encode_cursor

KINDS = ("defect", "object")
ORIGINS = ("user", "migrated")
MAX_LEVELS = 9  # the review keys 1-9 set severity (spec section 5.6)
NEEDS_CLASSIFICATION = "needs_classification"
log = logging.getLogger(__name__)
PALETTE = (
    "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6",
    "#a855f7", "#ec4899", "#ef4444", "#14b8a6", "#84cc16",
)


@dataclass(frozen=True)
class CatalogueTypeRef:
    id: str
    name: str
    colour: str
    kind: str
    default_severity: int | None
    hotkey: str | None
    group: str | None
    archived: bool
    origin: str


@dataclass(frozen=True)
class SeverityLevelRef:
    level: int
    name: str
    colour: str


def to_ref(row: CatalogueType) -> CatalogueTypeRef:
    return CatalogueTypeRef(
        id=row.id,
        name=row.name,
        colour=row.colour,
        kind=row.kind,
        default_severity=row.default_severity,
        hotkey=row.hotkey,
        group=row.group,
        archived=bool(row.archived),
        origin=row.origin,
    )


def _clean_name(name: str) -> tuple[str, str]:
    key = normalise_name(name)
    if not key:
        raise AppError("type_name_blank", "A type name cannot be blank.", 409)
    return " ".join(name.split()), key


def _group(value: str | None) -> str | None:
    """Whitespace collapsed; a blank group is no group."""
    if not value:
        return None
    return " ".join(value.split()) or None


def _check_kind(kind: str) -> None:
    if kind not in KINDS:
        raise AppError("validation_error", f"kind must be defect or object, not {kind!r}", 422)


def _check_default_severity(s, level: int | None) -> None:
    if level is None:
        return
    if s.get(SeverityLevel, level) is None:
        raise AppError("severity_unknown", f"There is no severity level {level}.", 422, {"level": level})


def _refuse_live_name(s, key: str, exclude: str | None = None) -> None:
    q = select(CatalogueType).where(CatalogueType.name_key == key, CatalogueType.archived.is_(False))
    if exclude:
        q = q.where(CatalogueType.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "type_exists",
            f"The catalogue already has a type called {holder.name}.",
            409,
            {"type_id": holder.id, "name": holder.name},
        )


def _refuse_live_hotkey(s, hotkey: str | None, exclude: str | None = None) -> None:
    if hotkey is None:
        return
    q = select(CatalogueType).where(CatalogueType.hotkey == hotkey, CatalogueType.archived.is_(False))
    if exclude:
        q = q.where(CatalogueType.id != exclude)
    holder = s.execute(q).scalars().first()
    if holder is not None:
        raise AppError(
            "hotkey_conflict",
            f"{holder.name} already uses the hotkey {hotkey}.",
            409,
            {"hotkey": hotkey, "type_id": holder.id},
        )


def _next_colour(s) -> str:
    n = s.execute(select(func.count()).select_from(CatalogueType)).scalar_one()
    return PALETTE[n % len(PALETTE)]


def create_type(
    cat: CatalogueHandle,
    *,
    name: str,
    colour: str | None = None,
    kind: str = "object",
    default_severity: int | None = None,
    hotkey: str | None = None,
    group: str | None = None,
    origin: str = "user",
) -> CatalogueTypeRef:
    clean, key = _clean_name(name)
    hotkey = normalise_hotkey(hotkey)
    _check_kind(kind)
    with cat.session() as s:
        _check_default_severity(s, default_severity)
        _refuse_live_name(s, key)
        _refuse_live_hotkey(s, hotkey)
        row = CatalogueType(
            name=clean,
            name_key=key,
            colour=(colour or _next_colour(s)).lower(),
            kind=kind,
            default_severity=default_severity,
            hotkey=hotkey,
            group=_group(group),
            origin=origin,
        )
        s.add(row)
        try:
            s.flush()
        except IntegrityError as e:  # a concurrent create of the same name or hotkey won the race
            raise AppError("type_exists", f"The catalogue already has a type called {clean}.", 409) from e
        return to_ref(row)


def get_type(cat: CatalogueHandle, type_id: str) -> CatalogueTypeRef:
    with cat.session() as s:
        row = s.get(CatalogueType, type_id)
        if row is None:
            raise not_found("catalogue type", type_id)
        return to_ref(row)


def resolve_types(cat: CatalogueHandle, type_ids: Iterable[str]) -> dict[str, CatalogueTypeRef]:
    """By id; an id the catalogue does not know is left out."""
    ids = list(dict.fromkeys(type_ids))
    if not ids:
        return {}
    with cat.session() as s:
        rows = s.execute(select(CatalogueType).where(CatalogueType.id.in_(ids))).scalars()
        return {r.id: to_ref(r) for r in rows}


def patch_type(cat: CatalogueHandle, type_id: str, fields: Mapping[str, Any]) -> tuple[CatalogueTypeRef, bool]:
    """Apply a patch; the flag is True when the kind went object -> defect, so the UI offers the
    findings backfill (spec section 7.2). Defect -> object keeps every existing finding."""
    with cat.session() as s:
        row = s.get(CatalogueType, type_id)
        if row is None:
            raise not_found("catalogue type", type_id)
        was = row.kind
        clean, key = _clean_name(fields["name"]) if "name" in fields else (row.name, row.name_key)
        hotkey = normalise_hotkey(fields["hotkey"]) if "hotkey" in fields else row.hotkey
        archived = bool(fields.get("archived", row.archived))
        if "kind" in fields:
            _check_kind(fields["kind"])
        if "default_severity" in fields:
            _check_default_severity(s, fields["default_severity"])
        if not archived:
            _refuse_live_name(s, key, exclude=row.id)
            _refuse_live_hotkey(s, hotkey, exclude=row.id)
        row.name, row.name_key, row.hotkey, row.archived = clean, key, hotkey, archived
        if "colour" in fields and fields["colour"]:
            row.colour = fields["colour"].lower()
        if "kind" in fields:
            row.kind = fields["kind"]
        if "default_severity" in fields:
            row.default_severity = fields["default_severity"]
        if "group" in fields:
            row.group = _group(fields["group"])
        s.flush()
        return to_ref(row), was == "object" and row.kind == "defect"


def list_types(
    cat: CatalogueHandle,
    *,
    q: str | None = None,
    kind: str | None = None,
    origin: str | None = None,
    include_archived: bool = False,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[CatalogueTypeRef], str | None]:
    n = clamp_limit(limit)
    query = select(CatalogueType)
    if not include_archived:
        query = query.where(CatalogueType.archived.is_(False))
    if kind:
        query = query.where(CatalogueType.kind == kind)
    if origin:
        query = query.where(CatalogueType.origin == origin)
    if q and normalise_name(q):
        query = query.where(CatalogueType.name_key.like(like_pattern(normalise_name(q)), escape="\\"))
    c = decode_cursor(cursor, "k", "id")
    if c:
        query = query.where(tuple_(CatalogueType.name_key, CatalogueType.id) > tuple_(c["k"], c["id"]))
    with cat.session() as s:
        rows = s.execute(query.order_by(CatalogueType.name_key, CatalogueType.id).limit(n + 1)).scalars().all()
        refs = [to_ref(r) for r in rows[:n]]
        nxt = encode_cursor(k=rows[n - 1].name_key, id=rows[n - 1].id) if len(rows) > n else None
    return refs, nxt


def _live_by_key(s, keys: set[str]) -> dict[str, CatalogueType]:
    rows = s.execute(
        select(CatalogueType).where(CatalogueType.name_key.in_(keys), CatalogueType.archived.is_(False))
    ).scalars()
    return {r.name_key: r for r in rows}


def find_by_names(cat: CatalogueHandle, names: Sequence[str]) -> dict[str, CatalogueTypeRef]:
    """Each name that matches a live type by `normalise_name` -> that type (names that normalise
    alike share one); an unmatched name is left out."""
    keys = {name: normalise_name(name) for name in names}
    with cat.session() as s:
        found = _live_by_key(s, {k for k in keys.values() if k})
        return {name: to_ref(found[key]) for name, key in keys.items() if key in found}


def ensure_types(
    cat: CatalogueHandle,
    names: Sequence[str],
    *,
    kind: str = "object",
    origin: str = "user",
    colours: Mapping[str, str] | None = None,
    hotkeys: Mapping[str, str | None] | None = None,
) -> dict[str, CatalogueTypeRef]:
    """`find_by_names`, creating each unmatched name as a new type of `kind` and `origin`: the Setup
    agent's "create missing as object" (spec section 7.3) and MG's catalogue merge (section 11.4
    step 1). A new type's colour comes from `colours`, its hotkey from `hotkeys` only when that
    hotkey is free. A name held only by an archived type gets a new live type (names are unique
    among live types only). A blank name is left out."""
    keys = {name: normalise_name(name) for name in names}
    with cat.session() as s:
        found = _live_by_key(s, {k for k in keys.values() if k})
        taken = set(
            s.execute(
                select(CatalogueType.hotkey).where(
                    CatalogueType.archived.is_(False), CatalogueType.hotkey.is_not(None)
                )
            ).scalars()
        )
        out: dict[str, CatalogueTypeRef] = {}
        for name, key in keys.items():
            if not key:
                continue
            row = found.get(key)
            if row is None:
                try:
                    hotkey = normalise_hotkey((hotkeys or {}).get(name))
                except AppError:
                    hotkey = None
                if hotkey in taken:
                    hotkey = None
                row = CatalogueType(
                    name=" ".join(name.split()),
                    name_key=key,
                    colour=((colours or {}).get(name) or _next_colour(s)).lower(),
                    kind=kind,
                    origin=origin,
                    hotkey=hotkey,
                )
                s.add(row)
                s.flush()
                if hotkey:
                    taken.add(hotkey)
                found[key] = row
            out[name] = to_ref(row)
    return out


def add_project_types(handle, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> list[str]:
    """Append types to a project's list in its own transaction (BM's run start, spec section 7.4);
    returns the ids that were added. See `project_types.add_types` for the in-session form."""
    from app.catalogue import project_types  # project_types imports this module

    with handle.session() as s:
        return project_types.add_types(s, cat, list(type_ids))


def get_scale(cat: CatalogueHandle) -> list[SeverityLevelRef]:
    with cat.session() as s:
        rows = s.execute(select(SeverityLevel).order_by(SeverityLevel.level)).scalars()
        return [SeverityLevelRef(r.level, r.name, r.colour) for r in rows]


def scale_levels(cat: CatalogueHandle | None) -> list[int]:
    """The scale's levels; D4's 1-4 when the catalogue is unavailable (decision F2)."""
    if cat is not None:
        try:
            return [lv.level for lv in get_scale(cat)]
        except Exception:
            log.exception("the severity scale could not be read")
    return [lv for lv, _, _ in DEFAULT_SCALE]


def put_scale(
    cat: CatalogueHandle, levels: Sequence[Mapping[str, Any]], level_in_use: Callable[[int], list[str]]
) -> list[SeverityLevelRef]:
    """Replace the scale: rename and recolour always, append at the top, and remove top levels only
    when `level_in_use(level)` names no project (spec section 7.2). Defaults above the new top are
    cleared."""
    wanted = sorted(levels, key=lambda lv: lv["level"])
    numbers = [lv["level"] for lv in wanted]
    if not 1 <= len(numbers) <= MAX_LEVELS or numbers != list(range(1, len(numbers) + 1)):
        raise AppError(
            "severity_scale_invalid",
            f"Levels run 1, 2, 3 ... with no gaps, 1 to {MAX_LEVELS} of them.",
            409,
            {"levels": numbers},
        )
    if any(not str(lv["name"]).strip() for lv in wanted):
        raise AppError("severity_scale_invalid", "Every severity level needs a name.", 409, {"levels": numbers})
    with cat.session() as s:
        top = s.execute(select(func.coalesce(func.max(SeverityLevel.level), 0))).scalar_one()
        for level in range(top, len(numbers), -1):  # the highest removed level first
            projects = level_in_use(level)
            if projects:
                raise AppError(
                    "severity_in_use",
                    f"Level {level} is still used by findings in {', '.join(projects)}.",
                    409,
                    {"level": level, "projects": projects},
                )
        s.execute(delete(SeverityLevel))
        s.add_all(
            SeverityLevel(level=lv["level"], name=str(lv["name"]).strip(), colour=str(lv["colour"]).lower())
            for lv in wanted
        )
        s.execute(
            update(CatalogueType).where(CatalogueType.default_severity > len(numbers)).values(default_severity=None)
        )
    return get_scale(cat)


def get_meta(cat: CatalogueHandle, key: str, default: Any = None) -> Any:
    with cat.session() as s:
        row = s.get(CatalogueMeta, key)
        return default if row is None else row.value


def set_meta(cat: CatalogueHandle, key: str, value: Any) -> None:
    with cat.session() as s:
        row = s.get(CatalogueMeta, key)
        if row is None:
            s.add(CatalogueMeta(key=key, value=value))
        else:
            row.value = value
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_catalogue_service.py tests/test_catalogue_db.py -v`
Expected: all pass (28 in the service file with its parametrised cases).

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app/catalogue tests/test_catalogue_service.py
& $PY -m ruff check app/catalogue tests/test_catalogue_service.py
cd ..
git add backend/app/catalogue/names.py backend/app/catalogue/service.py backend/tests/test_catalogue_service.py
git commit -m @'
feat(catalogue): type rules, resolve_types, find_by_names, ensure_types and the severity scale

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 3: Project migration `0010` and its ORM classes

**Files:**
- Create: `backend/app/db/migrations/versions/0010_foundation.py`
- Modify: `backend/app/db/models.py` (new classes at the end; `Project.finding_seq`; `ix_box_class`)
- Test: `backend/tests/test_migration_0010.py`

**Interfaces:**
- Consumes: `app.db.base.Base, UTCDateTime, new_id, utcnow`.
- Produces (ORM, `app.db.models`): `ProjectType`, `Finding` (with `ANCHOR_CHECK`), `FindingAttachment`, `FindingComment`, `FindingCount`, `FindingDaily`, `Activity`, `MigrationStep`, `ClassIdMap`; `Project.finding_seq: int`; index `ix_box_class`. Table and column names exactly as in the code below; later tasks and MG use them.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_migration_0010.py`:
```python
"""Migration 0010 (spec 2026-09-26-foundation section 11.1): the project type list, the finding
tables, the counts, the activity feed and MG's bookkeeping tables; `project.kind` dropped. A project
at 0009 upgrades with every row it had, and the anchor CHECK and the box foreign key hold."""

import sqlite3

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    Activity,
    Box,
    ClassIdMap,
    Finding,
    FindingAttachment,
    FindingComment,
    FindingCount,
    FindingDaily,
    MigrationStep,
    ProjectType,
)
from app.db.session import MIGRATIONS, make_session_factory, open_project_db

REVISION = "0010"
TABLES = {
    "project_type": ProjectType,
    "finding": Finding,
    "finding_attachment": FindingAttachment,
    "finding_comment": FindingComment,
    "finding_count": FindingCount,
    "finding_daily": FindingDaily,
    "activity": Activity,
    "migration_step": MigrationStep,
    "class_id_map": ClassIdMap,
}


def _cfg(folder=None) -> Config:
    cfg = Config(str(MIGRATIONS / "alembic.ini"))
    cfg.set_main_option("script_location", str(MIGRATIONS))
    if folder is not None:
        cfg.set_main_option("sqlalchemy.url", f"sqlite:///{(folder / 'project.db').as_posix()}")
    return cfg


def _at_0009(folder):
    folder.mkdir()
    command.upgrade(_cfg(folder), "0009")
    con = sqlite3.connect(folder / "project.db")
    con.execute(
        "INSERT INTO project (id, name, classes, schema_version, import_defaults, created_at, kind) VALUES"
        " ('p1', 'Old', '[{\"id\": \"c1\", \"name\": \"excavator\"}]', 1, '{}', '2026-01-01 00:00:00.000000', 'detect')"
    )
    con.execute(
        "INSERT INTO source (id, folder, site, settings, image_count, duplicate_count, created_at, kind)"
        " VALUES ('s1', 'C:/f', 'S', '{}', 1, 0, '2026-01-01 00:00:00.000000', 'images')"
    )
    con.execute(
        "INSERT INTO image (id, path, width, height, source_id, group_key, marked_empty, created_at)"
        " VALUES ('i1', 'images/a.jpg', 100, 100, 's1', '', 0, '2026-01-01 00:00:00.000000')"
    )
    con.execute(
        "INSERT INTO box (id, image_id, class_id, x, y, w, h, angle, provenance_kind, review_state, created_at)"
        " VALUES ('b1', 'i1', 'c1', 1, 1, 5, 5, 0, 'person', 'accepted', '2026-01-01 00:00:00.000000')"
    )
    con.commit()
    con.close()


@pytest.fixture
def engine(tmp_path):
    folder = tmp_path / "old"
    _at_0009(folder)
    eng = open_project_db(folder)
    yield eng
    eng.dispose()


def _columns(eng, table: str) -> set[str]:
    with eng.connect() as c:
        return {r[1] for r in c.exec_driver_sql(f"PRAGMA table_info({table})")}


def _cloud_finding(**kw) -> Finding:
    base = dict(
        number=1,
        type_id="t1",
        status="open",
        note="",
        created_by="human",
        anchor_kind="cloud",
        cloud_id="c1",
        x=0.0,
        y=0.0,
        z=0.0,
        data_type="point_cloud",
        data_id="c1",
    )
    return Finding(**{**base, **kw})


def test_the_chain_has_one_head_and_0010_is_on_it():
    script = ScriptDirectory.from_config(_cfg())
    heads = script.get_heads()
    assert len(heads) == 1, heads
    chain = {rev.revision for rev in script.walk_revisions(base="base", head=heads[0])}
    assert REVISION in chain


def test_a_0009_project_upgrades_with_its_rows_and_without_kind(engine):
    assert "kind" not in _columns(engine, "project")
    with engine.connect() as c:
        row = c.exec_driver_sql("SELECT id, name, classes, finding_seq FROM project").one()
        assert (row[0], row[1], row[3]) == ("p1", "Old", 0)
        assert "excavator" in row[2]
        assert c.exec_driver_sql("SELECT count(*) FROM box").scalar_one() == 1


@pytest.mark.parametrize("table", sorted(TABLES))
def test_every_model_column_exists(engine, table):
    assert {c.name for c in TABLES[table].__table__.columns} <= _columns(engine, table)


def test_the_box_class_index_exists(engine):
    with engine.connect() as c:
        names = {r[1] for r in c.exec_driver_sql("PRAGMA index_list(box)")}
    assert "ix_box_class" in names


def test_the_anchor_check_takes_one_kind_at_a_time(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(_cloud_finding())
        s.commit()
    for bad in (_cloud_finding(number=2, map_id="m1"), _cloud_finding(number=3, z=None)):
        with factory() as s, pytest.raises(IntegrityError):
            s.add(bad)
            s.commit()


def test_a_box_with_a_finding_cannot_be_deleted_behind_its_back(engine):
    factory = make_session_factory(engine)
    with factory() as s:
        s.add(
            Finding(
                number=1,
                type_id="c1",
                status="open",
                note="",
                created_by="human",
                anchor_kind="image",
                image_id="i1",
                annotation_id="b1",
                data_type="image_set",
                data_id="s1",
            )
        )
        s.commit()
    with factory() as s, pytest.raises(IntegrityError):
        s.delete(s.get(Box, "b1"))
        s.commit()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_migration_0010.py -v`
Expected: `ImportError: cannot import name 'Activity' from 'app.db.models'`.

- [ ] **Step 3: Add the ORM classes**

In `backend/app/db/models.py`:

1. Extend the SQLAlchemy import to `from sqlalchemy import JSON, Boolean, CheckConstraint, Date, Float, ForeignKey, Index, Integer, String, Text`.
2. In `class Project`, after `schema_version`, add:
   ```python
       # The high-water mark of finding numbers (spec section 8.1): allocation takes
       # max(finding_seq, max(finding.number)) + 1, so a deleted number is never handed out again.
       finding_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
   ```
   If BK left a `kind` mapping in `Project` (it should have removed it), delete it now: `0010` drops the column.
3. In `class Box`, add `Index("ix_box_class", "class_id"),` to `__table_args__`.
4. Append at the end of the file:
```python
class ProjectType(Base):
    """One entry of the project type list: a catalogue type this project uses, with a snapshot of it
    so the project renders without the catalogue (spec 2026-09-26-foundation section 7.3, F2)."""

    __tablename__ = "project_type"
    type_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    # None: the catalogue hotkey applies. "": no hotkey in this project (set only to clear a clash).
    hotkey_override: Mapped[str | None] = mapped_column(String(1), nullable=True)
    name: Mapped[str] = mapped_column(String)
    colour: Mapped[str] = mapped_column(String(7))
    kind: Mapped[str] = mapped_column(String)  # defect | object
    default_severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hotkey: Mapped[str | None] = mapped_column(String(1), nullable=True)
    group: Mapped[str | None] = mapped_column(String, nullable=True)
    refreshed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_project_type_position", "position"),)


ANCHOR_CHECK = (
    "(anchor_kind = 'image' AND image_id IS NOT NULL AND annotation_id IS NOT NULL"
    " AND map_id IS NULL AND geometry IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'map' AND map_id IS NOT NULL AND geometry IS NOT NULL"
    " AND image_id IS NULL AND annotation_id IS NULL AND cloud_id IS NULL"
    " AND x IS NULL AND y IS NULL AND z IS NULL AND uncertainty_m IS NULL)"
    " OR (anchor_kind = 'cloud' AND cloud_id IS NOT NULL AND x IS NOT NULL AND y IS NOT NULL"
    " AND z IS NOT NULL AND image_id IS NULL AND annotation_id IS NULL AND map_id IS NULL"
    " AND geometry IS NULL)"
)


class Finding(Base):
    """A defect with one anchor (spec 2026-09-26-foundation section 8.1, umbrella section 3)."""

    __tablename__ = "finding"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    number: Mapped[int] = mapped_column(Integer)  # shown as F-0217 (findings/numbers.py)
    type_id: Mapped[str] = mapped_column(String(36))  # a catalogue type id
    severity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open | reviewed | closed
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String, default="human")  # human | model:<id>
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    anchor_kind: Mapped[str] = mapped_column(String)  # image | map | cloud
    image_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # No ON DELETE: a box delete that skips findings/annotations.py fails loudly instead of leaving
    # a finding without its geometry and the counts wrong (plan BC, Review Focus 1).
    annotation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("box.id"), nullable=True)
    map_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # none_as_null: without it SQLAlchemy stores Python None as the JSON text 'null', which the CHECK
    # would read as NOT NULL.
    geometry: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    cloud_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    z: Mapped[float | None] = mapped_column(Float, nullable=True)
    uncertainty_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    data_type: Mapped[str] = mapped_column(String)  # image_set | map | point_cloud
    data_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (
        CheckConstraint(ANCHOR_CHECK, name="ck_finding_anchor"),
        CheckConstraint("status IN ('open', 'reviewed', 'closed')", name="ck_finding_status"),
        Index("ux_finding_number", "number", unique=True),
        Index("ux_finding_annotation", "annotation_id", unique=True),
        Index("ix_finding_status_severity_number", "status", "severity", "number"),
        Index("ix_finding_type", "type_id"),
        Index("ix_finding_data", "data_id"),
        Index("ix_finding_updated", "updated_at"),
        Index("ix_finding_image", "anchor_kind", "image_id"),
        Index("ix_finding_location", "lon", "lat"),
    )


class FindingAttachment(Base):
    __tablename__ = "finding_attachment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    finding_id: Mapped[str] = mapped_column(String(36), ForeignKey("finding.id", ondelete="CASCADE"))
    path: Mapped[str] = mapped_column(String)  # relative: findings/<finding_id>/<id>.<ext>
    original_name: Mapped[str] = mapped_column(String)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    __table_args__ = (Index("ix_finding_attachment_finding", "finding_id", "created_at"),)


class FindingComment(Base):
    __tablename__ = "finding_comment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    finding_id: Mapped[str] = mapped_column(String(36), ForeignKey("finding.id", ondelete="CASCADE"))
    author: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    __table_args__ = (Index("ix_finding_comment_finding", "finding_id", "created_at"),)


class FindingCount(Base):
    """Pre-aggregated finding numbers; findings/counts.py is the only writer (spec section 8.4)."""

    __tablename__ = "finding_count"
    status: Mapped[str] = mapped_column(String, primary_key=True)
    severity: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)  # -1 = none
    type_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    n: Mapped[int] = mapped_column(Integer, default=0)


class FindingDaily(Base):
    """One row per day with a finding write: the open numbers at the end of it and its closures."""

    __tablename__ = "finding_daily"
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    open: Mapped[int] = mapped_column(Integer, default=0)  # not closed: open + reviewed
    open_by_severity: Mapped[dict] = mapped_column(JSON, default=dict)  # {"1": n, ...}
    closed: Mapped[int] = mapped_column(Integer, default=0)
    # Not in the spec's column list: KPI 2 ("n closed this week" at the top level) needs it.
    closed_by_severity: Mapped[dict] = mapped_column(JSON, default=dict)  # {"4": n, "none": n}


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    kind: Mapped[str] = mapped_column(String)
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    __table_args__ = (Index("ix_activity_at", "at"), Index("ix_activity_subject", "subject_id", "at"))


class MigrationStep(Base):
    """MG's step records (spec section 11.4); BC only creates the table."""

    __tablename__ = "migration_step"
    name: Mapped[str] = mapped_column(String, primary_key=True)
    done_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class ClassIdMap(Base):
    """MG's old class id -> catalogue type id map (spec section 11.4 step 1)."""

    __tablename__ = "class_id_map"
    old_class_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    type_id: Mapped[str] = mapped_column(String(36))
```

- [ ] **Step 4: Write the migration**

`backend/app/db/migrations/versions/0010_foundation.py`:
```python
"""foundation: project types, findings, counts, activity, migration bookkeeping; drop project.kind

The one project schema change of the foundation sub-project (spec 2026-09-26-foundation section
11.1). Only new tables and one new column, plus the batch drop of `project.kind`; no row is
rewritten here. The data steps are MG's job (section 11.4), and MG's copy-first backup runs before
this revision (section 11.2).

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-26 00:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from app.db.models import ANCHOR_CHECK

revision = "0010"
down_revision = "0009"  # main's project head at merge time
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project") as b:
        b.drop_column("kind")
        b.add_column(sa.Column("finding_seq", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_box_class", "box", ["class_id"])
    op.create_table(
        "project_type",
        sa.Column("type_id", sa.String(36), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("hotkey_override", sa.String(1), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("colour", sa.String(7), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("default_severity", sa.Integer(), nullable=True),
        sa.Column("hotkey", sa.String(1), nullable=True),
        sa.Column("group", sa.String(), nullable=True),
        sa.Column("refreshed_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_project_type_position", "project_type", ["position"])
    op.create_table(
        "finding",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("type_id", sa.String(36), nullable=False),
        sa.Column("severity", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("anchor_kind", sa.String(), nullable=False),
        sa.Column("image_id", sa.String(36), nullable=True),
        sa.Column("annotation_id", sa.String(36), sa.ForeignKey("box.id"), nullable=True),
        sa.Column("map_id", sa.String(36), nullable=True),
        sa.Column("geometry", sa.JSON(), nullable=True),
        sa.Column("cloud_id", sa.String(36), nullable=True),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("z", sa.Float(), nullable=True),
        sa.Column("uncertainty_m", sa.Float(), nullable=True),
        sa.Column("lon", sa.Float(), nullable=True),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("data_type", sa.String(), nullable=False),
        sa.Column("data_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(ANCHOR_CHECK, name="ck_finding_anchor"),
        sa.CheckConstraint("status IN ('open', 'reviewed', 'closed')", name="ck_finding_status"),
    )
    op.create_index("ux_finding_number", "finding", ["number"], unique=True)
    op.create_index("ux_finding_annotation", "finding", ["annotation_id"], unique=True)
    op.create_index("ix_finding_status_severity_number", "finding", ["status", "severity", "number"])
    op.create_index("ix_finding_type", "finding", ["type_id"])
    op.create_index("ix_finding_data", "finding", ["data_id"])
    op.create_index("ix_finding_updated", "finding", ["updated_at"])
    op.create_index("ix_finding_image", "finding", ["anchor_kind", "image_id"])
    op.create_index("ix_finding_location", "finding", ["lon", "lat"])
    op.create_table(
        "finding_attachment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("original_name", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_finding_attachment_finding", "finding_attachment", ["finding_id", "created_at"])
    op.create_table(
        "finding_comment",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("finding_id", sa.String(36), sa.ForeignKey("finding.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("edited_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_finding_comment_finding", "finding_comment", ["finding_id", "created_at"])
    op.create_table(
        "finding_count",
        sa.Column("status", sa.String(), primary_key=True),
        sa.Column("severity", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("type_id", sa.String(36), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False),
    )
    op.create_table(
        "finding_daily",
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("open", sa.Integer(), nullable=False),
        sa.Column("open_by_severity", sa.JSON(), nullable=False),
        sa.Column("closed", sa.Integer(), nullable=False),
        sa.Column("closed_by_severity", sa.JSON(), nullable=False),
    )
    op.create_table(
        "activity",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("at", sa.DateTime(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("subject_id", sa.String(36), nullable=True),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    op.create_index("ix_activity_at", "activity", ["at"])
    op.create_index("ix_activity_subject", "activity", ["subject_id", "at"])
    op.create_table(
        "migration_step",
        sa.Column("name", sa.String(), primary_key=True),
        sa.Column("done_at", sa.DateTime(), nullable=False),
        sa.Column("detail", sa.JSON(), nullable=False),
    )
    op.create_table(
        "class_id_map",
        sa.Column("old_class_id", sa.String(36), primary_key=True),
        sa.Column("type_id", sa.String(36), nullable=False),
    )


def downgrade() -> None:
    for table in (
        "class_id_map",
        "migration_step",
        "activity",
        "finding_daily",
        "finding_count",
        "finding_comment",
        "finding_attachment",
        "finding",
        "project_type",
    ):
        op.drop_table(table)
    op.drop_index("ix_box_class", table_name="box")
    with op.batch_alter_table("project") as b:
        b.drop_column("finding_seq")
        b.add_column(sa.Column("kind", sa.String(), nullable=False, server_default="train"))
```

Importing `ANCHOR_CHECK` from the ORM keeps the constraint text in one place. Earlier revisions
avoid ORM imports, but this string is a constant and never changes meaning; if a later revision
changes the CHECK, it copies the old text into its own file first.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_migration_0010.py tests/test_migration_0009.py tests/test_migration_0008.py tests/test_db.py -v`
Expected: all pass. Then the whole suite, which must be unchanged from the Task 1 baseline:
`& $PY -m pytest -q -p no:cacheprovider`.

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff format app/db tests/test_migration_0010.py
& $PY -m ruff check app/db tests/test_migration_0010.py
cd ..
git add backend/app/db/models.py backend/app/db/migrations/versions/0010_foundation.py backend/tests/test_migration_0010.py
git commit -m @'
feat(db): migration 0010 - project types, findings, counts, activity; drop project.kind

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 4: Catalogue HTTP API

**Files:**
- Create: `backend/app/catalogue/schemas.py`, `backend/app/catalogue/usage.py`, `backend/app/catalogue/router.py`
- Modify: `backend/app/api.py` (include the router plainly)
- Modify: `backend/tests/test_contract.py` (delete C0's stub entries for the operations built here, if Task 1 found any; add `REFUSES_VALID_DATA` entries)
- Test: `backend/tests/test_catalogue_api.py`

**Interfaces:**
- Consumes: Task 2's service functions and refs; Task 1's `get_catalogue`; Task 3's `FindingCount`; the registry (`request.app.state.projects`, its `_handles` and `_lock`).
- Produces: `router` serving `GET/POST /catalogue/types` (the page carries `needs_classification`), `GET/PATCH /catalogue/types/{typeId}`, `GET/PUT /catalogue/severity`, `POST /catalogue/classification/done` → 204 (C0's `completeCatalogueClassification`: clears `NEEDS_CLASSIFICATION`; S2's banner "Done"; reconciliation 2026-09-26); `CatalogueTypeOut.from_ref(ref)`; `publish_catalogue_changed(request, payload)`; `projects_using_level(registry, level) -> list[str]`. Task 5 adds the snapshot refresh to the PATCH route, Task 12 adds `POST /catalogue/types/{typeId}/backfill`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_catalogue_api.py`:
```python
"""The catalogue endpoints (spec 2026-09-26-foundation sections 7.1-7.2, 13, 15)."""

from app.db.models import FindingCount

API = "/api/v1"
TYPES = f"{API}/catalogue/types"
SCALE = f"{API}/catalogue/severity"


def _post(client, **body):
    return client.post(TYPES, json=body)


def _error(r) -> dict:
    return r.json()["error"]


def test_create_list_and_get(client):
    r = _post(client, name="Crack", kind="defect", colour="#FF0000", hotkey="C", default_severity=2, group="Concrete")
    assert r.status_code == 201, r.text
    t = r.json()
    shown = {k: t[k] for k in ("name", "kind", "colour", "hotkey", "default_severity", "group", "archived", "origin")}
    assert shown == {
        "name": "Crack",
        "kind": "defect",
        "colour": "#ff0000",
        "hotkey": "c",
        "default_severity": 2,
        "group": "Concrete",
        "archived": False,
        "origin": "user",
    }
    assert client.get(f"{TYPES}/{t['id']}").json() == t
    assert [i["id"] for i in client.get(TYPES, params={"kind": "defect"}).json()["items"]] == [t["id"]]


def test_a_name_clash_answers_type_exists_with_the_existing_id(client):
    first = _post(client, name="dump_truck").json()
    r = _post(client, name="Dump truck")
    assert r.status_code == 409
    assert (_error(r)["code"], _error(r)["details"]["type_id"]) == ("type_exists", first["id"])


def test_marking_an_object_type_a_defect_offers_the_backfill(client):
    t = _post(client, name="Pothole").json()
    r = client.patch(f"{TYPES}/{t['id']}", json={"kind": "defect"})
    assert r.status_code == 200, r.text
    assert (r.json()["kind"], r.json()["backfill_candidates"]) == ("defect", True)
    r = client.patch(f"{TYPES}/{t['id']}", json={"colour": "#000000"})
    assert r.json()["backfill_candidates"] is False


def test_archived_types_are_listed_only_on_request(client):
    t = _post(client, name="Rust", kind="defect").json()
    client.patch(f"{TYPES}/{t['id']}", json={"archived": True})
    assert client.get(TYPES).json()["items"] == []
    listed = client.get(TYPES, params={"include_archived": "true"}).json()["items"]
    assert [(i["id"], i["archived"]) for i in listed] == [(t["id"], True)]


def test_the_scale_round_trips(client):
    levels = client.get(SCALE).json()["levels"]
    assert [lv["name"] for lv in levels] == ["Minor", "Moderate", "Major", "Critical"]
    levels.append({"level": 5, "name": "Severe", "colour": "#990000"})
    r = client.put(SCALE, json={"levels": levels})
    assert r.status_code == 200, r.text
    assert [lv["level"] for lv in client.get(SCALE).json()["levels"]] == [1, 2, 3, 4, 5]


def test_the_top_level_stays_while_an_open_project_uses_it(client, project, handle):
    with handle.session() as s:
        s.add(FindingCount(status="closed", severity=4, type_id="t1", n=1))
    levels = client.get(SCALE).json()["levels"][:3]
    r = client.put(SCALE, json={"levels": levels})
    assert r.status_code == 409
    assert (_error(r)["code"], _error(r)["details"]) == ("severity_in_use", {"level": 4, "projects": [project["name"]]})


def test_catalogue_edits_publish_catalogue_changed(client, monkeypatch):
    seen: list[dict] = []
    monkeypatch.setattr(client.app.state.events, "publish", seen.append)
    t = _post(client, name="Crack", kind="defect").json()
    client.patch(f"{TYPES}/{t['id']}", json={"colour": "#000000"})
    client.put(SCALE, json={"levels": client.get(SCALE).json()["levels"]})
    changed = [(e["project_id"], e["payload"]) for e in seen if e["type"] == "catalogue.changed"]
    assert changed == [
        ("library", {"type_ids": [t["id"]]}),
        ("library", {"type_ids": [t["id"]]}),
        ("library", {"severity": True}),
    ]


def test_the_classification_flag_is_listed_and_cleared(client):
    from app.catalogue import service

    assert client.get(TYPES).json().get("needs_classification", False) is False
    service.set_meta(client.app.state.catalogue, service.NEEDS_CLASSIFICATION, {"count": 12})
    assert client.get(TYPES).json()["needs_classification"] is True
    assert client.post(f"{API}/catalogue/classification/done").status_code == 204
    assert client.get(TYPES).json()["needs_classification"] is False


def test_without_the_catalogue_every_catalogue_endpoint_is_503(client):
    client.app.state.catalogue = None
    for r in (
        client.get(TYPES),
        _post(client, name="Crack"),
        client.get(f"{TYPES}/x"),
        client.patch(f"{TYPES}/x", json={"name": "y"}),
        client.get(SCALE),
        client.post(f"{API}/catalogue/classification/done"),
    ):
        assert (r.status_code, _error(r)["code"]) == (503, "catalogue_unavailable")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_catalogue_api.py -v`
Expected: FAIL, every test with `404` (or C0's `501` stub) instead of the asserted status.

- [ ] **Step 3: Implement**

`backend/app/catalogue/schemas.py` (field names from the Task 1 names table; C0's contract wins):
```python
"""Pydantic shapes of the catalogue schemas in contract/openapi.yaml."""

from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, Field

from app.catalogue.service import CatalogueTypeRef, SeverityLevelRef

HEX = r"^#[0-9a-fA-F]{6}$"
HOTKEY = r"^[1-9A-Za-z]$"
TypeKind = Literal["defect", "object"]
TypeOrigin = Literal["user", "migrated"]


class CatalogueTypeOut(BaseModel):
    id: str
    name: str
    colour: str
    kind: TypeKind
    default_severity: int | None
    hotkey: str | None
    group: str | None
    archived: bool
    origin: TypeOrigin

    @classmethod
    def from_ref(cls, ref: CatalogueTypeRef) -> "CatalogueTypeOut":
        return cls(**asdict(ref))


class CatalogueTypePatchOut(CatalogueTypeOut):
    backfill_candidates: bool = False


class CatalogueTypePage(BaseModel):
    items: list[CatalogueTypeOut]
    next_cursor: str | None = None
    needs_classification: bool = False


class CatalogueTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    colour: str | None = Field(None, pattern=HEX)
    kind: TypeKind = "object"
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    group: str | None = Field(None, max_length=64)


class CatalogueTypePatch(BaseModel):
    """Every field optional; `model_dump(exclude_unset=True)` is the patch. `default_severity`,
    `hotkey` and `group` accept null (clear)."""

    name: str = Field(default=None, min_length=1, max_length=64)
    colour: str = Field(default=None, pattern=HEX)
    kind: TypeKind = Field(default=None)
    default_severity: int | None = Field(None, ge=1, le=9)
    hotkey: str | None = Field(None, pattern=HOTKEY)
    group: str | None = Field(None, max_length=64)
    archived: bool = Field(default=None)


class SeverityLevelOut(BaseModel):
    level: int = Field(ge=1, le=9)
    name: str = Field(min_length=1, max_length=32)
    colour: str = Field(pattern=HEX)

    @classmethod
    def from_ref(cls, ref: SeverityLevelRef) -> "SeverityLevelOut":
        return cls(level=ref.level, name=ref.name, colour=ref.colour)


class SeverityScale(BaseModel):
    levels: list[SeverityLevelOut] = Field(min_length=1, max_length=9)
```

`backend/app/catalogue/usage.py`:
```python
"""Which open projects still use a severity level (spec 2026-09-26-foundation section 7.2)."""

import logging

from sqlalchemy import func, select

from app.db.models import FindingCount

log = logging.getLogger(__name__)


def projects_using_level(registry, level: int) -> list[str]:
    """Names of the open projects whose findings (any status) carry `level`: one SUM over the small
    `finding_count` table each. A project that is not open is not asked; a finding there whose level
    no longer exists renders as "Level 5 (removed)" (spec section 7.2)."""
    with registry._lock:  # the registry's own list of open projects (spec section 10.1 reads it too)
        handles = list(registry._handles.values())
    names: list[str] = []
    for h in handles:
        try:
            with h.session() as s:
                n = s.execute(
                    select(func.coalesce(func.sum(FindingCount.n), 0)).where(FindingCount.severity == level)
                ).scalar_one()
                if n:
                    names.append(h.row(s).name)
        except Exception:
            log.exception("could not read finding counts of project %s", h.id)
    return sorted(names)
```

`backend/app/catalogue/router.py`:
```python
"""The catalogue endpoints (spec 2026-09-26-foundation sections 7 and 13)."""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from app.catalogue import service
from app.catalogue.handle import CatalogueHandle, get_catalogue
from app.catalogue.schemas import (
    CatalogueTypeCreate,
    CatalogueTypeOut,
    CatalogueTypePage,
    CatalogueTypePatch,
    CatalogueTypePatchOut,
    SeverityLevelOut,
    SeverityScale,
    TypeKind,
)
from app.catalogue.usage import projects_using_level

router = APIRouter(prefix="/catalogue", tags=["catalogue"])


def publish_catalogue_changed(request: Request, payload: dict) -> None:
    """`catalogue.changed`; `project_id` is "library" because the contract's Event.project_id is a
    non-null string and the catalogue is app-wide, like library jobs."""
    request.app.state.events.publish(
        {
            "type": "catalogue.changed",
            "project_id": "library",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": payload,
        }
    )


@router.get("/types", response_model=CatalogueTypePage)
def list_catalogue_types(
    q: str | None = Query(None, max_length=64),
    kind: TypeKind | None = None,
    origin: Literal["user", "migrated"] | None = None,
    include_archived: bool = False,
    limit: int | None = Query(None, ge=1),
    cursor: str | None = None,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> CatalogueTypePage:
    refs, nxt = service.list_types(
        cat, q=q, kind=kind, origin=origin, include_archived=include_archived, cursor=cursor, limit=limit
    )
    flag = bool(service.get_meta(cat, service.NEEDS_CLASSIFICATION))
    return CatalogueTypePage(items=[CatalogueTypeOut.from_ref(r) for r in refs], next_cursor=nxt, needs_classification=flag)


@router.post("/classification/done", status_code=204)
def complete_catalogue_classification(request: Request, cat: CatalogueHandle = Depends(get_catalogue)) -> Response:
    """The operator reviewed the types the migration merged in (C0 `completeCatalogueClassification`)."""
    service.set_meta(cat, service.NEEDS_CLASSIFICATION, None)
    publish_catalogue_changed(request, {"classification": "done"})
    return Response(status_code=204)


@router.post("/types", response_model=CatalogueTypeOut, status_code=201)
def create_catalogue_type(
    body: CatalogueTypeCreate, request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> CatalogueTypeOut:
    ref = service.create_type(cat, **body.model_dump())
    publish_catalogue_changed(request, {"type_ids": [ref.id]})
    return CatalogueTypeOut.from_ref(ref)


@router.get("/types/{typeId}", response_model=CatalogueTypeOut)
def get_catalogue_type(typeId: str, cat: CatalogueHandle = Depends(get_catalogue)) -> CatalogueTypeOut:  # noqa: N803
    return CatalogueTypeOut.from_ref(service.get_type(cat, typeId))


@router.patch("/types/{typeId}", response_model=CatalogueTypePatchOut)
def patch_catalogue_type(
    typeId: str,  # noqa: N803
    body: CatalogueTypePatch,
    request: Request,
    cat: CatalogueHandle = Depends(get_catalogue),
) -> CatalogueTypePatchOut:
    ref, offer = service.patch_type(cat, typeId, body.model_dump(exclude_unset=True))
    publish_catalogue_changed(request, {"type_ids": [ref.id]})
    return CatalogueTypePatchOut(**CatalogueTypeOut.from_ref(ref).model_dump(), backfill_candidates=offer)


@router.get("/severity", response_model=SeverityScale)
def get_severity_scale(cat: CatalogueHandle = Depends(get_catalogue)) -> SeverityScale:
    return SeverityScale(levels=[SeverityLevelOut.from_ref(lv) for lv in service.get_scale(cat)])


@router.put("/severity", response_model=SeverityScale)
def put_severity_scale(
    body: SeverityScale, request: Request, cat: CatalogueHandle = Depends(get_catalogue)
) -> SeverityScale:
    registry = request.app.state.projects
    levels = service.put_scale(
        cat,
        [lv.model_dump() for lv in body.levels],
        level_in_use=lambda level: projects_using_level(registry, level),
    )
    publish_catalogue_changed(request, {"severity": True})
    return SeverityScale(levels=[SeverityLevelOut.from_ref(lv) for lv in levels])
```

In `backend/app/api.py`: add `from app.catalogue.router import router as catalogue_router` in
sorted position and `catalogue_router,` to the plain `for r in (...)` tuple. If Task 1 found C0
stubs for these eight operations (the seven above and `completeCatalogueClassification`), delete their
tuples and their `EXPECTED_STUBS` entries. Import `Response` from `fastapi` in the router if it is not
imported yet; if `set_meta(..., None)` does not delete the row in Task 2's code, make it do so (a
`None` value clears the key).

In `backend/tests/test_contract.py`, add to `REFUSES_VALID_DATA`:
```python
    # BC: a schema-valid default severity above the scale (`severity_unknown`), a hotkey the
    # contract pattern allows but the catalogue reads differently (`hotkey_invalid`).
    "createCatalogueType": {422},
    "patchCatalogueType": {422},
```
(use the operationIds recorded in Task 1.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_catalogue_api.py tests/test_contract.py -q -p no:cacheprovider`
Expected: the catalogue tests pass; `test_contract.py` fails only on BC operations not built yet
(findings, types, overview), the same list as the Task 1 baseline minus the seven catalogue ones.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app/catalogue app/api.py tests/test_catalogue_api.py tests/test_contract.py
& $PY -m ruff check app/catalogue app/api.py tests/test_catalogue_api.py tests/test_contract.py
cd ..
git add backend/app/catalogue/schemas.py backend/app/catalogue/usage.py backend/app/catalogue/router.py backend/app/api.py backend/tests/test_catalogue_api.py backend/tests/test_contract.py
git commit -m @'
feat(catalogue): /catalogue/types and /catalogue/severity with severity_in_use

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 5: The project type list

**Files:**
- Create: `backend/app/catalogue/project_types.py`, `backend/app/catalogue/project_router.py`
- Create: `backend/tests/findings_helpers.py`, `backend/tests/test_project_types.py`
- Modify: `backend/app/db/models.py` (`Project.legacy_classes` + the derived `classes` property)
- Modify: `backend/app/projects/service.py` (`ProjectHandle.catalogue`, `ProjectRegistry.catalogue`, `create`, `_cache`; delete `check_removed_classes_unused`)
- Modify: `backend/app/projects/router.py` (delete the `PUT /{projectId}/classes` route)
- Modify: `backend/app/projects/schemas.py` (`ClassDef` gains `kind`, `default_severity`, `group`)
- Modify: `backend/app/detect/class_maps.py` (`append_classes` through the catalogue)
- Modify: `backend/app/catalogue/router.py` (refresh open projects after a PATCH)
- Modify: `backend/app/main.py` (`project_opened` step "project type snapshot refresh")
- Modify: `backend/app/api.py` (include `project_router`)
- Modify: `backend/tests/project_factory.py` (BK's helper, through catalogue types)
- Modify: `backend/tests/test_projects.py` (delete the five `/classes` tests), `backend/tests/test_exports_csv.py` (two class renames), `backend/tests/test_contract.py` (keep C0's `RETIRING` entry for `updateClasses`: S1 removes it with the path)

**Interfaces:**
- Consumes: Task 2 `service.resolve_types` (by id), `service.ensure_types`, `normalise_hotkey`; Task 1 `catalogue_unavailable`; Task 3 `ProjectType`, `Box`, `Finding`; BK's `ProjectRegistry.create(name, folder, type_ids)`, `_cache(pid, folder, engine, name, remember)`, `tests/project_factory.py::new_project`.
- Produces: `project_classes(s, legacy=None) -> list[dict]` (ClassDef dicts: `id, name, colour, hotkey, order, kind, default_severity, group`); `effective_hotkey(row) -> str | None`; `lookup_types(cat, type_ids) -> dict[str, CatalogueTypeRef]`; `set_types(s, cat, type_ids, hotkeys=None)`; `add_types(s, cat, type_ids) -> list[str]`; `check_removed_types_unused(s, type_ids)`; `refresh_snapshots(s, cat, type_ids=None) -> int`; `refresh_handle(handle) -> int`; `refresh_open_projects(registry, cat, type_ids)`; `append_by_names(s, cat, names) -> dict[str, str]`; `ProjectHandle.catalogue` (the app's `CatalogueHandle | None`); `PUT /projects/{projectId}/types`; `tests/findings_helpers.py::add_type(client, name, *, kind="defect", **body) -> dict`, `use_types(client, project, *types) -> dict`.

- [ ] **Step 0: Rebase onto BK (index "Cut after")**

BK merges first in batch 2. If `git log --oneline main` does not show BK's merge yet, wait for it.
Then `git rebase main` in `f-bc` and run `Select-String -Path backend\app\*\*.py -Pattern "register_finding_search|def open_recent"`.
Expected: both found (BK), and `backend\tests\project_factory.py` exists.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/findings_helpers.py`:
```python
"""Shared helpers for the catalogue and finding tests (plan BC)."""

API = "/api/v1"


def add_type(client, name: str, *, kind: str = "defect", **body) -> dict:
    """A catalogue type, created through the API."""
    r = client.post(f"{API}/catalogue/types", json={"name": name, "kind": kind, **body})
    assert r.status_code == 201, r.text
    return r.json()


def use_types(client, project: dict, *types: dict) -> dict:
    """Append `types` to the project's type list; returns the updated project."""
    current = [c["id"] for c in client.get(f"{API}/projects/{project['id']}").json()["classes"]]
    r = client.put(f"{API}/projects/{project['id']}/types", json={"type_ids": current + [t["id"] for t in types]})
    assert r.status_code == 200, r.text
    return r.json()
```

Create `backend/tests/test_project_types.py`:
```python
"""The project type list (spec 2026-09-26-foundation section 7.3): ordered catalogue types with a
snapshot each, served as `Project.classes`, refreshed from the catalogue, and still readable when the
catalogue is down (decision F2)."""

import pytest
from conftest import EIGHT_CLASSES
from findings_helpers import add_type, use_types

from app.catalogue import project_types
from app.catalogue import service as catalogue
from app.db.models import Box, Finding, Image, Source

API = "/api/v1"


def _classes(client, pid: str) -> list[dict]:
    return client.get(f"{API}/projects/{pid}").json()["classes"]


def _put(client, pid: str, type_ids: list[str], hotkeys: dict | None = None):
    body: dict = {"type_ids": type_ids}
    if hotkeys is not None:
        body["hotkeys"] = hotkeys
    return client.put(f"{API}/projects/{pid}/types", json=body)


def test_a_new_project_lists_its_types_as_classes(project):
    classes = project["classes"]
    assert [c["name"] for c in classes] == EIGHT_CLASSES
    assert [c["order"] for c in classes] == list(range(8))
    first = classes[0]
    assert (first["kind"], first["hotkey"], first["default_severity"], first["group"]) == ("object", "1", None, None)


def test_put_types_reorders_and_keeps_ids(client, project):
    ids = [c["id"] for c in project["classes"]]
    r = _put(client, project["id"], list(reversed(ids)))
    assert r.status_code == 200, r.text
    assert [c["id"] for c in r.json()["classes"]] == list(reversed(ids))


def test_a_type_with_annotations_cannot_leave_the_list(client, project, handle):
    ids = [c["id"] for c in project["classes"]]
    with handle.session() as s:
        src = Source(folder="C:/f", site="S")
        s.add(src)
        s.flush()
        img = Image(path="images/a.jpg", width=10, height=10, source_id=src.id)
        s.add(img)
        s.flush()
        s.add(Box(image_id=img.id, class_id=ids[0], x=1, y=1, w=2, h=2, provenance_kind="person", review_state="accepted"))
    r = _put(client, project["id"], ids[1:])
    assert r.status_code == 409
    err = r.json()["error"]
    assert (err["code"], err["details"]["box_count"], err["details"]["finding_count"]) == ("class_in_use", 1, 0)


def test_a_type_with_findings_cannot_leave_the_list(client, project, handle):
    crack = add_type(client, "crack")
    use_types(client, project, crack)
    with handle.session() as s:
        s.add(
            Finding(
                number=1,
                type_id=crack["id"],
                status="open",
                note="",
                created_by="human",
                anchor_kind="cloud",
                cloud_id="c1",
                x=0.0,
                y=0.0,
                z=0.0,
                data_type="point_cloud",
                data_id="c1",
            )
        )
    r = _put(client, project["id"], [c["id"] for c in project["classes"]])
    assert r.status_code == 409
    assert (r.json()["error"]["code"], r.json()["error"]["details"]["finding_count"]) == ("class_in_use", 1)


def test_hotkey_overrides_must_not_clash(client, project):
    ids = [c["id"] for c in project["classes"]]
    r = _put(client, project["id"], ids, {ids[1]: "1"})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "hotkey_conflict")
    r = _put(client, project["id"], ids, {ids[0]: "Q"})
    assert r.status_code == 200, r.text
    assert r.json()["classes"][0]["hotkey"] == "q"
    r = _put(client, project["id"], ids)  # no `hotkeys`: overrides stay
    assert r.json()["classes"][0]["hotkey"] == "q"


def test_an_unknown_type_is_422(client, project):
    r = _put(client, project["id"], [c["id"] for c in project["classes"]] + ["nope"])
    assert (r.status_code, r.json()["error"]["code"], r.json()["error"]["details"]) == (
        422,
        "unknown_type",
        {"type_ids": ["nope"]},
    )


def test_catalogue_edits_refresh_open_projects(client, project):
    tid = project["classes"][0]["id"]
    r = client.patch(f"{API}/catalogue/types/{tid}", json={"name": "Digger", "colour": "#000000", "kind": "defect"})
    assert r.status_code == 200, r.text
    c = _classes(client, project["id"])[0]
    assert (c["name"], c["colour"], c["kind"]) == ("Digger", "#000000", "defect")


def test_opening_a_project_refreshes_its_snapshot(client, project, handle):
    catalogue.patch_type(client.app.state.catalogue, project["classes"][0]["id"], {"name": "Digger"})
    assert project_types.refresh_handle(handle) == 1
    assert _classes(client, project["id"])[0]["name"] == "Digger"
    assert project_types.refresh_handle(handle) == 0


def test_a_project_renders_from_its_snapshot_without_the_catalogue(client, project, handle):
    client.app.state.catalogue = None
    client.app.state.projects.catalogue = None
    handle.catalogue = None
    assert [c["name"] for c in _classes(client, project["id"])] == EIGHT_CLASSES
    r = _put(client, project["id"], [c["id"] for c in project["classes"]] + ["new-type"])
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")


def test_creating_a_project_with_types_needs_the_catalogue(client, tmp_path):
    client.app.state.projects.catalogue = None
    r = client.post(f"{API}/projects", json={"name": "P", "folder": str(tmp_path / "p2"), "type_ids": ["x"]})
    assert (r.status_code, r.json()["error"]["code"]) == (503, "catalogue_unavailable")
    assert not (tmp_path / "p2").exists()


def test_a_new_project_has_nothing_to_migrate(project):
    assert project["schema_version"] == 2


def test_the_legacy_class_list_cannot_be_written_through_classes(handle):
    with handle.session() as s, pytest.raises(AttributeError):
        handle.row(s).classes = []


def test_a_pre_foundation_project_shows_its_legacy_classes_until_migrated(handle):
    with handle.session() as s:
        s.query(project_types.ProjectType).delete()
        row = handle.row(s)
        row.schema_version = 1
        row.legacy_classes = [{"id": "c1", "name": "excavator", "colour": "#ff0000", "hotkey": "1", "order": 0}]
    with handle.session() as s:
        assert project_types.project_classes(s, legacy=handle.row(s)) == [
            {
                "id": "c1",
                "name": "excavator",
                "colour": "#ff0000",
                "hotkey": "1",
                "order": 0,
                "kind": "object",
                "default_severity": None,
                "group": None,
            }
        ]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_project_types.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.catalogue.project_types'`.

- [ ] **Step 3: The project type list module**

`backend/app/catalogue/project_types.py`:
```python
"""The project type list (spec 2026-09-26-foundation section 7.3): the ordered catalogue types a
project uses, each with a snapshot of its catalogue row (decision F2), so a project renders its
annotations and findings even when the catalogue cannot open or the project came from another
machine.

Every function that writes takes the caller's project session: the list and whatever depends on it
change in one transaction.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue import service as catalogue
from app.catalogue.handle import CatalogueHandle, catalogue_unavailable
from app.catalogue.names import normalise_hotkey
from app.db.base import utcnow
from app.db.models import Box, Finding, Project, ProjectType
from app.errors import AppError

SNAPSHOT = ("name", "colour", "kind", "default_severity", "hotkey", "group")
log = logging.getLogger(__name__)

__all__ = [
    "ProjectType",
    "add_types",
    "append_by_names",
    "check_removed_types_unused",
    "effective_hotkey",
    "lookup_types",
    "project_classes",
    "refresh_handle",
    "refresh_open_projects",
    "refresh_snapshots",
    "set_types",
]


def effective_hotkey(row: ProjectType) -> str | None:
    """The project's override when set ("" = none in this project), else the catalogue's hotkey."""
    if row.hotkey_override is None:
        return row.hotkey
    return row.hotkey_override or None


def project_classes(s: Session, legacy: Project | None = None) -> list[dict]:
    """The list as ClassDef dicts, in order. A project from before the foundation (`schema_version`
    below 2) that has no type rows yet shows its legacy classes, whose ids its boxes still carry,
    until MG's migration fills `project_type` (spec section 11.4 steps 1-3)."""
    rows = s.execute(select(ProjectType).order_by(ProjectType.position, ProjectType.type_id)).scalars().all()
    if not rows and legacy is not None and (legacy.schema_version or 1) < 2:
        return [
            {
                "id": c["id"],
                "name": c["name"],
                "colour": c.get("colour") or "#4f46e5",
                "hotkey": c.get("hotkey"),
                "order": c.get("order", i),
                "kind": "object",
                "default_severity": None,
                "group": None,
            }
            for i, c in enumerate(legacy.legacy_classes or [])
        ]
    return [
        {
            "id": r.type_id,
            "name": r.name,
            "colour": r.colour,
            "hotkey": effective_hotkey(r),
            "order": r.position,
            "kind": r.kind,
            "default_severity": r.default_severity,
            "group": r.group,
        }
        for r in rows
    ]


def lookup_types(cat: CatalogueHandle | None, type_ids: Sequence[str]) -> dict[str, catalogue.CatalogueTypeRef]:
    """The catalogue rows for these ids: 503 without a catalogue, 422 `unknown_type` for a stranger."""
    ids = list(dict.fromkeys(type_ids))
    if not ids:
        return {}
    if cat is None:
        raise catalogue_unavailable()
    found = catalogue.resolve_types(cat, ids)
    missing = [t for t in ids if t not in found]
    if missing:
        raise AppError("unknown_type", f"Not catalogue types: {', '.join(missing)}.", 422, {"type_ids": missing})
    return found


def _snapshot(row: ProjectType, ref: catalogue.CatalogueTypeRef) -> None:
    for field in SNAPSHOT:
        setattr(row, field, getattr(ref, field))
    row.refreshed_at = utcnow()


def _check_hotkeys(rows: Iterable[ProjectType]) -> None:
    seen: dict[str, ProjectType] = {}
    for r in rows:
        key = effective_hotkey(r)
        if not key:
            continue
        if key in seen:
            raise AppError(
                "hotkey_conflict",
                f"{seen[key].name} and {r.name} both use the hotkey {key} in this project.",
                409,
                {"hotkey": key, "type_ids": [seen[key].type_id, r.type_id]},
            )
        seen[key] = r


def check_removed_types_unused(s: Session, type_ids: Iterable[str]) -> None:
    """The `class_in_use` rule, now counting findings too (spec section 7.3)."""
    for type_id in type_ids:
        boxes = s.execute(select(func.count()).select_from(Box).where(Box.class_id == type_id)).scalar_one()
        findings = s.execute(select(func.count()).select_from(Finding).where(Finding.type_id == type_id)).scalar_one()
        if boxes or findings:
            row = s.get(ProjectType, type_id)
            name = row.name if row is not None else type_id
            raise AppError(
                "class_in_use",
                f"{name} still has {boxes} annotations and {findings} findings; reassign or delete them first.",
                409,
                {"class_id": type_id, "box_count": boxes, "finding_count": findings},
            )


def set_types(
    s: Session,
    cat: CatalogueHandle | None,
    type_ids: Sequence[str],
    hotkeys: Mapping[str, str | None] | None = None,
) -> None:
    """Make the list exactly `type_ids`, in that order. New ids need the catalogue; kept ids keep
    their snapshot. `hotkeys` (when given) replaces every override: {type_id: key}, null clears one."""
    wanted = list(dict.fromkeys(type_ids))
    existing = {r.type_id: r for r in s.execute(select(ProjectType)).scalars()}
    removed = [t for t in existing if t not in set(wanted)]
    check_removed_types_unused(s, removed)
    refs = lookup_types(cat, [t for t in wanted if t not in existing])
    if hotkeys is None:
        overrides = {t: r.hotkey_override for t, r in existing.items()}
    else:
        overrides = {t: normalise_hotkey(k) for t, k in hotkeys.items() if t in set(wanted)}
    for t in removed:
        s.delete(existing[t])
    rows: list[ProjectType] = []
    for position, t in enumerate(wanted):
        row = existing.get(t)
        if row is None:
            row = ProjectType(type_id=t)
            _snapshot(row, refs[t])
            s.add(row)
        row.position = position
        row.hotkey_override = overrides.get(t)
        rows.append(row)
    _check_hotkeys(rows)
    s.flush()


def add_types(s: Session, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> list[str]:
    """Append the ids the list does not hold yet (a run's mapped types, a finding's type). A clash
    of the new type's hotkey with this project's list clears it for this project only."""
    rows = s.execute(select(ProjectType).order_by(ProjectType.position)).scalars().all()
    held = {r.type_id for r in rows}
    new = [t for t in dict.fromkeys(type_ids) if t not in held]
    if not new:
        return []
    refs = lookup_types(cat, new)
    taken = {effective_hotkey(r) for r in rows} - {None}
    top = max((r.position for r in rows), default=-1)
    for i, t in enumerate(new):
        row = ProjectType(type_id=t, position=top + 1 + i)
        _snapshot(row, refs[t])
        if row.hotkey and row.hotkey in taken:
            row.hotkey_override = ""
        elif row.hotkey:
            taken.add(row.hotkey)
        s.add(row)
    s.flush()
    return new


def refresh_snapshots(s: Session, cat: CatalogueHandle | None, type_ids: Iterable[str] | None = None) -> int:
    """Copy the catalogue's current name, colour, kind, default severity, hotkey and group into the
    snapshot rows; returns how many changed. Without a catalogue, or for a type this catalogue does
    not know (a project from another machine), the snapshot stays as it is."""
    if cat is None:
        return 0
    q = select(ProjectType)
    if type_ids is not None:
        q = q.where(ProjectType.type_id.in_(list(type_ids)))
    rows = s.execute(q).scalars().all()
    refs = catalogue.resolve_types(cat, [r.type_id for r in rows])
    changed = 0
    for row in rows:
        ref = refs.get(row.type_id)
        if ref is None or all(getattr(row, f) == getattr(ref, f) for f in SNAPSHOT):
            continue
        _snapshot(row, ref)
        changed += 1
    return changed


def refresh_handle(handle) -> int:
    """On project open (spec section 7.3)."""
    with handle.session() as s:
        return refresh_snapshots(s, handle.catalogue)


def refresh_open_projects(registry, cat: CatalogueHandle | None, type_ids: Sequence[str]) -> None:
    """After a catalogue edit: every open project's snapshot of these types. A failing project is
    logged; its snapshot refreshes on its next open."""
    with registry._lock:
        handles = list(registry._handles.values())
    for h in handles:
        try:
            with h.session() as s:
                refresh_snapshots(s, cat, type_ids)
        except Exception:
            log.exception("could not refresh the type snapshot of project %s", h.id)


def append_by_names(s: Session, cat: CatalogueHandle | None, names: Sequence[str]) -> dict[str, str]:
    """Resolve names against the catalogue (a missing one becomes a new `object` type), append them
    to the list, and return {name: type_id} for the whole list and for every requested name."""
    if cat is None:
        raise catalogue_unavailable()
    refs = catalogue.ensure_types(cat, [n for n in names if n.strip()])
    add_types(s, cat, [r.id for r in refs.values()])
    out = {c["name"]: c["id"] for c in project_classes(s)}
    out.update({name: ref.id for name, ref in refs.items()})
    return out
```

- [ ] **Step 4: `Project.classes` becomes derived**

In `backend/app/db/models.py`, `class Project`, replace the line
`classes: Mapped[list] = mapped_column(JSON, default=list)  # [{id, name, colour, hotkey, order}]` with:
```python
    # The pre-foundation class list: read-only, MG's migration input, kept for one release (spec
    # section 6.1). The live list is `project_type`; `classes` below derives from it.
    legacy_classes: Mapped[list] = mapped_column("classes", JSON, default=list)

    @property
    def classes(self) -> list[dict]:
        """The project type list as ClassDef dicts (spec section 7.3), read through this row's
        session, so every `handle.row(s).classes` reader keeps working. There is no setter: a writer
        left over from before the foundation fails loudly instead of writing the legacy column."""
        from sqlalchemy.orm import object_session

        from app.catalogue.project_types import project_classes

        s = object_session(self)
        if s is None:
            raise RuntimeError("Project.classes reads project_type: the row must be in a session")
        return project_classes(s, legacy=self)
```

- [ ] **Step 5: The registry, the routes and the schemas**

`backend/app/projects/service.py`:
1. In `class ProjectHandle`, directly under the class line, add:
   ```python
       # The app's CatalogueHandle, set by the registry when the project becomes live; None when the
       # catalogue could not open (spec F2: the project then renders from its type snapshots).
       catalogue = None
   ```
2. In `ProjectRegistry.__init__`, add `self.catalogue = None  # set in the lifespan (app.main.open_catalogue)`.
3. Replace BK's `create` with:
   ```python
       def create(self, name: str, folder: Path, type_ids: list[str]) -> ProjectHandle:
           """Create a project folder whose type list is `type_ids` (catalogue ids, in order). The
           ids are checked before any folder is touched: 503 without a catalogue, 422 for an unknown
           id. A new project has nothing to migrate, so it starts at schema_version 2."""
           from app.catalogue import project_types

           folder = folder.resolve()
           wanted = list(dict.fromkeys(type_ids))
           project_types.lookup_types(self.catalogue, wanted)
           with self._lock:
               if (folder / "project.db").exists():
                   raise AppError("already_exists", f"{folder} already contains a project", 409)
               for sub in SUBDIRS:
                   (folder / sub).mkdir(parents=True, exist_ok=True)
               engine = open_project_db(folder)
               row = Project(name=name, schema_version=2, import_defaults=dict(DEFAULT_IMPORT_SETTINGS))
               with make_session_factory(engine)() as s:
                   s.add(row)
                   s.flush()
                   project_types.set_types(s, self.catalogue, wanted)
                   s.commit()
                   pid = row.id
               return self._cache(pid, folder, engine, name, remember=True)
   ```
4. In `_cache`, directly after `h = ProjectHandle(pid, folder, engine)`, add `h.catalogue = self.catalogue`.
5. Delete `check_removed_classes_unused` (the rule lives in `project_types.check_removed_types_unused`). Keep `normalise_classes` (tests build pre-foundation projects with it).

`backend/app/projects/router.py`: delete the `update_classes` route (`PUT /{projectId}/classes`)
and the imports only it used (`ClassDefInput`, `check_removed_classes_unused`, `normalise_classes`).
Delete `ClassDefInput` from `backend/app/projects/schemas.py` if nothing else imports it
(`Select-String -Path app\*.py,app\*\*.py -Pattern ClassDefInput`).

`backend/app/projects/schemas.py`, `class ClassDef`: add three fields with defaults (a frozen
`dataset.classes` entry has none of them):
```python
    kind: Literal["defect", "object"] = "object"
    default_severity: int | None = None
    group: str | None = None
```

`backend/app/catalogue/project_router.py`:
```python
"""`PUT /projects/{projectId}/types` (spec 2026-09-26-foundation section 7.3); replaces
`PUT /projects/{projectId}/classes`."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.catalogue import project_types
from app.projects.router import _out as project_out
from app.projects.schemas import ProjectOut
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["projects"])


class ProjectTypesPut(BaseModel):
    type_ids: list[str] = Field(max_length=500)
    hotkeys: dict[str, str | None] | None = None


@router.put("/types", response_model=ProjectOut)
def put_project_types(body: ProjectTypesPut, handle: ProjectHandle = Depends(get_project)) -> ProjectOut:
    with handle.session() as s:
        project_types.set_types(s, handle.catalogue, body.type_ids, body.hotkeys)
    return project_out(handle)
```
In `backend/app/api.py`, import it as `from app.catalogue.project_router import router as project_types_router`
and add `project_types_router,` to the plain tuple. If C0 stubbed `putProjectTypes`, delete the stub
and its `EXPECTED_STUBS` entry. Keep C0's `RETIRING` entry for `updateClasses` in
`tests/test_contract.py` (Task 1 Step 1 (b)): it lets the route go now while the deprecated path
stays until S1 removes it. Add `"putProjectTypes": {422},` to
`REFUSES_VALID_DATA` (`unknown_type` for generated ids).

`backend/app/catalogue/router.py`, `patch_catalogue_type`: after `service.patch_type(...)` add
```python
    project_types.refresh_open_projects(request.app.state.projects, cat, [ref.id])
```
with `from app.catalogue import project_types, service` at the top.

`backend/app/main.py`, `project_opened`: add this step to the tuple, directly before
`("model adoption", ...)`:
```python
        ("project type snapshot refresh", lambda: importlib.import_module("app.catalogue.project_types").refresh_handle(handle)),
```

`backend/app/detect/class_maps.py`: replace the body of `append_classes` (keep its signature):
```python
def append_classes(s: Session, handle: ProjectHandle, names: list[str]) -> dict[str, str]:
    """Add each name to the project's type list, resolved against the catalogue by normalise_name
    (a missing name becomes a new `object` type, spec 2026-09-26-foundation section 7.3); returns
    `{name: type_id}` for the list and for every requested name. Called inside the caller's
    session, so the list and whatever maps onto it change together."""
    from app.catalogue import project_types

    return project_types.append_by_names(s, handle.catalogue, [n.strip() for n in names if n.strip()])
```
Then delete imports and constants left unused (`normalise_classes`, `PALETTE`, `HOTKEYS` if only
`append_classes` used them); `ruff check` names them.

- [ ] **Step 6: Tests build their projects through the catalogue**

Replace `backend/tests/project_factory.py` (BK's helper) with:
```python
"""Creating a project in a test (plans BK and BC; spec 2026-09-26-foundation sections 6.1, 7.3).

A project is created with `{name, folder, type_ids}`. A test that needs classes names them: each
becomes a catalogue type (the existing one when the catalogue already has that name), and the
project's type list is those types in order.
"""

from pathlib import Path

BASE = "/api/v1/projects"
TYPES = "/api/v1/catalogue/types"
DEFAULT_COLOUR = "#4f46e5"


def catalogue_type(client, c: dict) -> str:
    """The catalogue type id for class dict `c` ({name, colour?, hotkey?, kind?, default_severity?,
    group?}). A name clash reuses the existing type; a hotkey clash drops the hotkey."""
    body = {"name": c["name"], "colour": c.get("colour") or DEFAULT_COLOUR, "kind": c.get("kind", "object")}
    for key in ("hotkey", "default_severity", "group"):
        if c.get(key) is not None:
            body[key] = c[key]
    r = client.post(TYPES, json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "hotkey_conflict":
        body.pop("hotkey")
        r = client.post(TYPES, json=body)
    if r.status_code == 409 and r.json()["error"]["code"] == "type_exists":
        return r.json()["error"]["details"]["type_id"]
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_project(client, folder: Path, *, name: str = "T", classes: list[dict] | None = None) -> dict:
    type_ids = list(dict.fromkeys(catalogue_type(client, c) for c in classes or []))
    r = client.post(BASE, json={"name": name, "folder": str(folder), "type_ids": type_ids})
    assert r.status_code == 201, r.text
    return r.json()
```

`backend/tests/test_projects.py`: delete the five tests that call `PUT /projects/{id}/classes`
(`test_update_classes_reorders_and_keeps_ids`, `test_duplicate_class_name_is_409`,
`test_a_blank_class_name_is_409`, `test_duplicate_hotkey_is_409`,
`test_removing_class_with_boxes_is_409`). Their rules are pinned by `test_project_types.py` and
`test_catalogue_service.py`.

`backend/tests/test_exports_csv.py`: the two blocks that rename a class write the snapshot instead.
In each, replace
```python
        project = handle.row(s)
        classes = list(project.classes)
        classes[0] = {**classes[0], "name": "=1+1"}
        project.classes = classes
        s.add(project)
        s.flush()
```
with
```python
        classes = list(handle.row(s).classes)
        s.get(ProjectType, classes[0]["id"]).name = "=1+1"
        s.flush()
```
(keeping whatever name the block uses instead of `"=1+1"`), and add `ProjectType` to the file's
`from app.db.models import ...`.

Find any other writer that the property now refuses:
```powershell
Select-String -Path app\*.py,app\*\*.py,tests\*.py -Pattern "\.classes = |Project\([^)]*classes="
```
Expected: no match. A match is ported the same way (a snapshot write in tests; `set_types` or
`add_types` in app code).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_project_types.py tests/test_projects.py tests/test_class_maps.py tests/test_exports_csv.py tests/test_boxes.py -v`
Expected: all pass. Then the whole suite: `& $PY -m pytest -q -p no:cacheprovider`. Expected: the
Task 1 baseline, minus the `putProjectTypes` contract failure. A test that fails because a
pre-foundation fixture project (`test_library_adoption.py`) reads its classes is covered by the
legacy fallback in `project_classes`; if one still fails, it wrote `Project(classes=...)`, which
becomes `legacy_classes=`.

- [ ] **Step 8: Lint and commit**

```powershell
& $PY -m ruff format app tests
& $PY -m ruff check app tests
cd ..
git status --short
git add backend/app/catalogue/project_types.py backend/app/catalogue/project_router.py backend/app/catalogue/router.py backend/app/db/models.py backend/app/projects/service.py backend/app/projects/router.py backend/app/projects/schemas.py backend/app/detect/class_maps.py backend/app/main.py backend/app/api.py backend/tests/findings_helpers.py backend/tests/test_project_types.py backend/tests/project_factory.py backend/tests/test_projects.py backend/tests/test_exports_csv.py backend/tests/test_contract.py
git commit -m @'
feat(catalogue): project type list with snapshots; Project.classes derives from it

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```
If `ruff format` touched other files, `git status --short` lists them: stage those paths too, by
name.

---

### Task 6: Counts, activity, numbers and the change events

**Files:**
- Create: `backend/app/findings/__init__.py`, `backend/app/findings/events.py`, `backend/app/findings/numbers.py`, `backend/app/findings/counts.py`, `backend/app/findings/activity.py`
- Modify: `backend/app/main.py` (`findings.events.set_bus(app.state.events)` in `lifespan`)
- Test: `backend/tests/test_findings_plumbing.py`

**Interfaces:**
- Consumes: Task 3's `Finding`, `FindingCount`, `FindingDaily`, `Activity`, `Project.finding_seq`; `app.pagination`.
- Produces:
  - `events.mark_changed(s, project_id, ids)`, `events.set_bus(bus)`, `events.MAX_IDS = 100`
  - `numbers.format_number(n) -> str`, `numbers.parse_number(text) -> int | None`, `numbers.allocate(s, count=1) -> int` (the first of `count` new numbers)
  - `counts.Key = tuple[str, int | None, str]`, `counts.key_of(f) -> Key`, `counts.change(s, old, new)`, `counts.settle_day(s, day=None)`, `counts.recount(s, day=None) -> {"findings": int, "buckets": int}`, `counts.today() -> date`, `counts.open_now(s) -> tuple[int, dict[str, int]]`, `counts.NO_SEVERITY = -1`, `counts.OPEN_STATES = ("open", "reviewed")`
  - `activity.record(s, kind, subject_id, summary, payload=None)`, `activity.page(s, *, subject_id=None, cursor=None, limit=None) -> tuple[list[Activity], str | None]`, `activity.KINDS`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_plumbing.py`:
```python
"""The plumbing under every finding write (spec 2026-09-26-foundation sections 8.1, 8.3, 8.4): the
number allocator, the counts module, the activity feed and the findings.changed event."""

from datetime import UTC, date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.db.models import Activity, Finding, FindingCount, FindingDaily
from app.errors import AppError
from app.findings import activity, counts, events, numbers

DAY = date(2026, 9, 26)


@pytest.fixture(autouse=True)
def fixed_day(monkeypatch):
    monkeypatch.setattr(counts, "today", lambda: DAY)


class _Bus:
    def __init__(self):
        self.seen: list[dict] = []

    def publish(self, event: dict) -> None:
        self.seen.append(event)


@pytest.fixture
def bus(monkeypatch) -> _Bus:
    b = _Bus()
    monkeypatch.setattr(events, "_bus", b)
    return b


def _finding(number: int, status: str = "open", severity: int | None = None, type_id: str = "t1") -> Finding:
    return Finding(
        number=number,
        type_id=type_id,
        severity=severity,
        status=status,
        note="",
        created_by="human",
        anchor_kind="cloud",
        cloud_id="c1",
        x=0.0,
        y=0.0,
        z=0.0,
        data_type="point_cloud",
        data_id="c1",
    )


def _counts(s) -> dict:
    return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}


def _add(s, f: Finding) -> Finding:
    s.add(f)
    s.flush()
    counts.change(s, None, counts.key_of(f))
    return f


def test_format_and_parse_numbers():
    assert numbers.format_number(7) == "F-0007"
    assert numbers.format_number(12345) == "F-12345"
    for text, n in [("F-0217", 217), ("f217", 217), (" 217 ", 217), ("F-12", 12)]:
        assert numbers.parse_number(text) == n
    for text in ["crack", "F-", "", "F-12a"]:
        assert numbers.parse_number(text) is None


def test_allocate_follows_the_high_water_mark(handle):
    with handle.session() as s:
        assert numbers.allocate(s) == 1
        assert numbers.allocate(s, count=3) == 2
    with handle.session() as s:
        assert numbers.allocate(s) == 5
    with handle.session() as s:
        s.add(_finding(40))  # a number written directly (MG's migration) moves the mark
        s.flush()
        assert numbers.allocate(s) == 41


def test_change_moves_one_finding_between_buckets(handle):
    with handle.session() as s:
        f = _add(s, _finding(1, severity=2))
        f.status = "closed"
        counts.change(s, ("open", 2, "t1"), counts.key_of(f))
    with handle.session() as s:
        assert _counts(s) == {("closed", 2, "t1"): 1}
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.open_by_severity, day.closed, day.closed_by_severity) == (0, {}, 1, {"2": 1})


def test_the_day_counts_open_and_reviewed_as_open(handle):
    with handle.session() as s:
        for n, (status, sev) in enumerate([("open", 1), ("reviewed", 1), ("reviewed", None), ("closed", 4)], start=1):
            _add(s, _finding(n, status=status, severity=sev))
    with handle.session() as s:
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.open_by_severity, day.closed, day.closed_by_severity) == (3, {"1": 2}, 1, {"4": 1})


def test_a_rolled_back_write_leaves_no_numbers(handle):
    with pytest.raises(RuntimeError), handle.session() as s:
        _add(s, _finding(1))
        raise RuntimeError("boom")
    with handle.session() as s:
        assert _counts(s) == {}
        assert s.get(FindingDaily, DAY) is None


def test_recount_rebuilds_the_numbers_and_todays_closures(handle):
    noon = datetime.combine(DAY, time(12)).astimezone(UTC)
    with handle.session() as s:
        s.add(_finding(1, severity=3))
        closed = _finding(2, status="closed", severity=4)
        closed.closed_at = noon
        s.add(closed)
        old = _finding(3, status="closed")
        old.closed_at = noon - timedelta(days=3)
        s.add(old)
        s.add(FindingCount(status="open", severity=9, type_id="ghost", n=7))
    with handle.session() as s:
        result = counts.recount(s)
    assert result == {"findings": 3, "buckets": 3}
    with handle.session() as s:
        assert _counts(s) == {("open", 3, "t1"): 1, ("closed", 4, "t1"): 1, ("closed", -1, "t1"): 1}
        day = s.get(FindingDaily, DAY)
        assert (day.open, day.closed, day.closed_by_severity) == (1, 1, {"4": 1})


def test_marked_ids_publish_once_after_commit(handle, bus):
    with handle.session() as s:
        s.execute(select(FindingCount)).all()  # a transaction to commit, as every real write has
        events.mark_changed(s, "p1", ["b", "a"])
        events.mark_changed(s, "p1", ["a"])
        assert bus.seen == []
    assert bus.seen == [
        {
            "type": "findings.changed",
            "project_id": "p1",
            "job_id": None,
            "progress": None,
            "message": "",
            "payload": {"ids": ["a", "b"]},
        }
    ]


def test_more_than_100_ids_publish_all(handle, bus):
    with handle.session() as s:
        s.execute(select(FindingCount)).all()
        events.mark_changed(s, "p1", [f"id{i}" for i in range(101)])
    assert bus.seen[0]["payload"] == {"all": True}


def test_a_rollback_publishes_nothing(handle, bus):
    with pytest.raises(RuntimeError), handle.session() as s:
        events.mark_changed(s, "p1", ["a"])
        raise RuntimeError("boom")
    assert bus.seen == []


def test_activity_pages_newest_first_and_filters_by_subject(handle):
    base = datetime(2026, 9, 26, 8, tzinfo=UTC)
    with handle.session() as s:
        for i in range(5):
            s.add(Activity(at=base + timedelta(minutes=i), kind="finding.comment", subject_id="f1" if i % 2 == 0 else "f2", summary=f"c{i}", payload={}))
    with handle.session() as s:
        first, cursor = activity.page(s, limit=2)
        second, _ = activity.page(s, limit=2, cursor=cursor)
        only, end = activity.page(s, subject_id="f2")
        assert [a.summary for a in first + second] == ["c4", "c3", "c2", "c1"]
        assert ([a.summary for a in only], end) == (["c3", "c1"], None)


def test_activity_kinds_are_the_spec_list(handle):
    with handle.session() as s:
        activity.record(s, "finding.created", "f1", "F-0001 crack created")
        with pytest.raises(AppError):
            activity.record(s, "finding.exploded", "f1", "no")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_plumbing.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.findings'`.

- [ ] **Step 3: Implement**

`backend/app/findings/__init__.py`:
```python
"""Findings: one entity for defects found in images, maps and point clouds (spec
2026-09-26-foundation section 8; umbrella section 3)."""
```

`backend/app/findings/events.py`:
```python
"""`findings.changed` (spec 2026-09-26-foundation section 8.3).

Every finding write marks its ids on the session; one after-commit listener publishes them. Routes,
jobs, the box hooks and M's map review therefore all publish the same way, only for work that
really committed, and once per transaction.
"""

from collections.abc import Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

MAX_IDS = 100
_KEY = "findings_changed"
_bus = None


def set_bus(bus) -> None:
    """The app's EventBus, wired in the lifespan."""
    global _bus
    _bus = bus


def mark_changed(s: Session, project_id: str, ids: Iterable[str]) -> None:
    pending: dict[str, set[str]] = s.info.setdefault(_KEY, {})
    pending.setdefault(project_id, set()).update(ids)


@event.listens_for(Session, "after_commit")
def _publish(s: Session) -> None:
    pending = s.info.pop(_KEY, None)
    if not pending or _bus is None:
        return
    for project_id, ids in pending.items():
        payload = {"ids": sorted(ids)} if len(ids) <= MAX_IDS else {"all": True}
        _bus.publish(
            {
                "type": "findings.changed",
                "project_id": project_id,
                "job_id": None,
                "progress": None,
                "message": "",
                "payload": payload,
            }
        )


@event.listens_for(Session, "after_rollback")
def _forget(s: Session) -> None:
    s.info.pop(_KEY, None)
```

`backend/app/findings/numbers.py`:
```python
"""Human finding numbers (spec 2026-09-26-foundation section 8.1): `F-` plus at least four digits,
allocated inside the create transaction, never reused after a delete."""

import re

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import Finding, Project

_NUMBER = re.compile(r"^\s*(?:F-?)?(\d{1,9})\s*$", re.IGNORECASE)


def format_number(n: int) -> str:
    return f"F-{n:04d}"


def parse_number(text: str) -> int | None:
    """`F-0217`, `f217` or `217` -> 217; anything else -> None."""
    m = _NUMBER.match(text or "")
    return int(m.group(1)) if m else None


def allocate(s: Session, count: int = 1) -> int:
    """Reserve `count` consecutive numbers; returns the first. The UPDATE comes first, so this
    transaction holds SQLite's write lock before it reads the new mark: two writers cannot get the
    same number. `max(finding_seq, max(number))` also covers numbers written directly (MG's
    migration), and a deleted top number is never handed out again."""
    top = select(func.coalesce(func.max(Finding.number), 0)).scalar_subquery()
    s.execute(
        update(Project)
        .values(finding_seq=func.max(Project.finding_seq, top) + count)
        .execution_options(synchronize_session=False)
    )
    last = s.execute(select(Project.finding_seq)).scalar_one()
    return last - count + 1
```

`backend/app/findings/counts.py`:
```python
"""The only writer of `finding_count` and `finding_daily` (spec 2026-09-26-foundation section 8.4,
ADR 2026-09-23-counts-live-on-run-rows): one place holds the numbers, and a recount repairs them.

`change(s, old, new)` is called by every finding write inside its transaction. The buckets are
bumped at once with an upsert. The day's row is settled once per transaction by a `before_commit`
listener, so a bulk write of 1000 findings aggregates once, and a caller outside this package (M's
map review through `service.create_in_session`) cannot forget it.

"Open" on dashboards means not closed: `open` and `reviewed` (a reviewed finding is a confirmed
defect still waiting for its fix).
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, event, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.db.models import Finding, FindingCount, FindingDaily

NO_SEVERITY = -1
OPEN_STATES = ("open", "reviewed")
Key = tuple[str, int | None, str]  # (status, severity, type_id)
_PENDING = "finding_daily_pending"
log = logging.getLogger(__name__)


def today() -> date:
    """The operator's local day (the backend runs on the operator's machine). Tests patch this."""
    return datetime.now().date()


def key_of(f: Finding) -> Key:
    return (f.status, f.severity, f.type_id)


def _sev(value: int | None) -> int:
    return NO_SEVERITY if value is None else int(value)


def _label(sev: int) -> str:
    return "none" if sev == NO_SEVERITY else str(sev)


def _bump(s: Session, key: Key, delta: int) -> None:
    status, severity, type_id = key
    stmt = sqlite_insert(FindingCount).values(status=status, severity=_sev(severity), type_id=type_id, n=max(delta, 0))
    stmt = stmt.on_conflict_do_update(
        index_elements=["status", "severity", "type_id"],
        set_={"n": func.max(FindingCount.n + delta, 0)},
    )
    s.execute(stmt)


def change(s: Session, old: Key | None, new: Key | None) -> None:
    """One finding moved from `old` to `new` (None = it did not exist / no longer exists)."""
    if old == new:
        return
    if old is not None:
        _bump(s, old, -1)
    if new is not None:
        _bump(s, new, +1)
    pending: Counter = s.info.setdefault(_PENDING, Counter())
    if new is not None and new[0] == "closed" and (old is None or old[0] != "closed"):
        pending[_label(_sev(new[1]))] += 1


def open_now(s: Session) -> tuple[int, dict[str, int]]:
    """Not-closed findings now: the total and {level: n} for graded ones (the small counts table)."""
    rows = s.execute(
        select(FindingCount.severity, func.sum(FindingCount.n))
        .where(FindingCount.status.in_(OPEN_STATES))
        .group_by(FindingCount.severity)
    ).all()
    total = sum(int(n or 0) for _, n in rows)
    by = {str(sev): int(n) for sev, n in rows if sev != NO_SEVERITY and n}
    return total, by


def _day_row(s: Session, day: date) -> FindingDaily:
    row = s.get(FindingDaily, day)
    if row is None:
        row = FindingDaily(day=day, open=0, open_by_severity={}, closed=0, closed_by_severity={})
        s.add(row)
    return row


def settle_day(s: Session, day: date | None = None) -> None:
    """Write the day's row: the open numbers as they stand, plus this transaction's closures."""
    pending: Counter | None = s.info.pop(_PENDING, None)
    if pending is None:
        return
    row = _day_row(s, day or today())
    row.open, row.open_by_severity = open_now(s)
    closed = dict(row.closed_by_severity or {})
    for label, n in pending.items():
        closed[label] = closed.get(label, 0) + n
    row.closed_by_severity = closed  # a new dict: plain JSON does not track in-place changes
    row.closed = (row.closed or 0) + sum(pending.values())


@event.listens_for(Session, "before_commit")
def _settle(s: Session) -> None:
    if _PENDING in s.info:
        settle_day(s)


@event.listens_for(Session, "after_rollback")
def _forget(s: Session) -> None:
    s.info.pop(_PENDING, None)


def recount(s: Session, day: date | None = None) -> dict:
    """Rebuild `finding_count` from `finding`, and today's `finding_daily` row (its open numbers,
    and its closures from `closed_at`). Earlier days are history that cannot be rebuilt; they stay."""
    s.execute(delete(FindingCount))
    rows = s.execute(
        select(Finding.status, func.coalesce(Finding.severity, NO_SEVERITY), Finding.type_id, func.count())
        .group_by(Finding.status, func.coalesce(Finding.severity, NO_SEVERITY), Finding.type_id)
    ).all()
    s.add_all(FindingCount(status=st, severity=sev, type_id=t, n=n) for st, sev, t, n in rows)
    s.flush()
    day = day or today()
    start = datetime.combine(day, time.min).astimezone(UTC)  # local midnight, as UTC
    closed_rows = s.execute(
        select(func.coalesce(Finding.severity, NO_SEVERITY), func.count())
        .where(Finding.status == "closed", Finding.closed_at >= start, Finding.closed_at < start + timedelta(days=1))
        .group_by(func.coalesce(Finding.severity, NO_SEVERITY))
    ).all()
    row = _day_row(s, day)
    row.open, row.open_by_severity = open_now(s)
    row.closed_by_severity = {_label(sev): n for sev, n in closed_rows}
    row.closed = sum(n for _, n in closed_rows)
    s.info.pop(_PENDING, None)
    return {"findings": sum(n for *_, n in rows), "buckets": len(rows)}
```

`backend/app/findings/activity.py`:
```python
"""The project activity feed (spec 2026-09-26-foundation section 8.1): the Overview's feed and the
inspector's history."""

from datetime import datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.db.models import Activity
from app.errors import AppError
from app.pagination import clamp_limit, decode_cursor, encode_cursor

KINDS = (
    "finding.created",
    "finding.status",
    "finding.severity",
    "finding.comment",
    "data.imported",
    "job.finished",
    "detections.accepted",
)
MAX_SUMMARY = 200


def record(s: Session, kind: str, subject_id: str | None, summary: str, payload: dict | None = None) -> None:
    if kind not in KINDS:
        raise AppError("validation_error", f"unknown activity kind {kind!r}", 422)
    s.add(Activity(kind=kind, subject_id=subject_id, summary=summary[:MAX_SUMMARY], payload=payload or {}))


def page(
    s: Session, *, subject_id: str | None = None, cursor: str | None = None, limit: int | None = None
) -> tuple[list[Activity], str | None]:
    """Newest first, keyset on (at, id)."""
    n = clamp_limit(limit)
    q = select(Activity)
    if subject_id:
        q = q.where(Activity.subject_id == subject_id)
    c = decode_cursor(cursor, "at", "id")
    if c:
        at = datetime.fromisoformat(c["at"])
        q = q.where(or_(Activity.at < at, and_(Activity.at == at, Activity.id < c["id"])))
    rows = s.execute(q.order_by(Activity.at.desc(), Activity.id.desc()).limit(n + 1)).scalars().all()
    nxt = encode_cursor(at=rows[n - 1].at.isoformat(), id=rows[n - 1].id) if len(rows) > n else None
    return list(rows[:n]), nxt
```

`backend/app/main.py`, `lifespan`: directly after `app.state.events.bind(...)` add
```python
        from app.findings import events as findings_events

        findings_events.set_bus(app.state.events)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_plumbing.py -v`
Expected: 11 passed.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app/findings app/main.py tests/test_findings_plumbing.py
& $PY -m ruff check app/findings app/main.py tests/test_findings_plumbing.py
cd ..
git add backend/app/findings/__init__.py backend/app/findings/events.py backend/app/findings/numbers.py backend/app/findings/counts.py backend/app/findings/activity.py backend/app/main.py backend/tests/test_findings_plumbing.py
git commit -m @'
feat(findings): number allocator, counts module, activity feed, findings.changed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 7: Finding service: create, change, delete

**Files:**
- Create: `backend/app/findings/anchors.py`, `backend/app/findings/trash.py`, `backend/app/findings/service.py`
- Modify: `backend/tests/findings_helpers.py` (map and cloud helpers), `backend/tests/conftest.py` (the `crack` fixture)
- Test: `backend/tests/test_findings_service.py`

**Interfaces:**
- Consumes: Task 5 `project_types.lookup_types`, `add_types`, `ProjectType`; Task 6 `counts.change`, `counts.key_of`, `activity.record`, `events.mark_changed`, `numbers.allocate`, `numbers.format_number`; Task 2 `service.get_scale`; Task 3 `Finding`, `FindingAttachment`, `FindingComment`, `GeoMap`, `PointCloud`, `Image`, `Box`.
- Produces: `AnchorIn` (see "Public interfaces"); `anchors.resolve(s, anchor, *, lon=None, lat=None) -> dict`; `anchors.repatch(s, row, patch) -> dict`; `anchors.check_geometry(g) -> dict`; `anchors.to_wgs84(crs_wkt, x, y)`; `trash.move(handle, finding_ids, now=None) -> int`, `trash.move_file(handle, rel_path, now=None)`, `trash.purge(handle, now=None, keep_days=30) -> int`, `trash.finding_dir(handle, finding_id) -> Path`; `service.STATUSES`, `service.TRANSITIONS`, `service.UNSET`, `service.defect_type(s, catalogue, type_id) -> ProjectType`, `service.check_severity(catalogue, level)`, `create_in_session`, `patch_in_session`, `delete_in_session`, `delete_for_anchor`, `create_finding`, `get_finding(handle, id) -> tuple[Finding, int, int]`, `patch_finding`, `delete_finding` (signatures in "Public interfaces"); conftest fixture `crack` (a defect type "crack", default severity 2, in `project`'s list); `findings_helpers.insert_map`, `insert_cloud`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/findings_helpers.py`:
```python
def insert_map(handle, *, name: str = "April", crs_wkt: str | None = None) -> str:
    """A ready map row, straight into the project DB (no GeoTIFF needed for anchors)."""
    from app.db.models import GeoMap

    with handle.session() as s:
        row = GeoMap(name=name, status="ready", source_path="C:/maps/x.tif", source_size=1, crs_wkt=crs_wkt)
        s.add(row)
        s.flush()
        return row.id


def insert_cloud(handle, *, name: str = "Scan", crs_wkt: str | None = None) -> str:
    """A ready point-cloud row, straight into the project DB."""
    from app.db.models import PointCloud

    with handle.session() as s:
        row = PointCloud(name=name, status="ready", source_path="C:/clouds/x.laz", source_size=1, crs_wkt=crs_wkt)
        s.add(row)
        s.flush()
        return row.id
```

In `backend/tests/conftest.py`, add after the `handle` fixture:
```python
@pytest.fixture
def crack(client, project) -> dict:
    """A defect type "crack" (default severity 2) in the catalogue and at the end of `project`'s
    type list (plan BC)."""
    from findings_helpers import add_type, use_types

    t = add_type(client, "crack", colour="#ff5a4f", default_severity=2)
    use_types(client, project, t)
    return t
```

Create `backend/tests/test_findings_service.py`:
```python
"""The finding service (spec 2026-09-26-foundation sections 8.1, 8.2, 8.5): numbers, defaults,
defects only, the status table, anchors, activity and counts in the same transaction."""

import pytest
from findings_helpers import add_type, insert_cloud, insert_map
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.models import Activity, Finding, FindingCount
from app.errors import AppError
from app.findings import service, trash
from app.findings.anchors import AnchorIn


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _at(cloud_id: str, **kw) -> AnchorIn:
    return AnchorIn(kind="cloud", cloud_id=cloud_id, x=1.0, y=2.0, z=3.0, **kw)


def _counts(handle) -> dict:
    with handle.session() as s:
        return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}


def _refused(fn, *args, **kwargs) -> AppError:
    with pytest.raises(AppError) as e:
        fn(*args, **kwargs)
    return e.value


def test_create_numbers_defaults_and_counts(handle, crack, cloud):
    a = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    b = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=None, note="hairline")
    assert (a.number, b.number) == (1, 2)
    assert (a.status, a.severity, a.created_by, a.note) == ("open", 2, "human", "")
    assert (b.severity, b.note) == (None, "hairline")
    assert (a.anchor_kind, a.data_type, a.data_id, a.x, a.y, a.z) == ("cloud", "point_cloud", cloud, 1.0, 2.0, 3.0)
    assert _counts(handle) == {("open", 2, crack["id"]): 1, ("open", -1, crack["id"]): 1}


def test_numbers_are_never_reused_after_a_delete(handle, crack, cloud):
    service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    top = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    service.delete_finding(handle, top.id)
    assert service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud)).number == 3


def test_a_finding_can_start_reviewed_or_closed(handle, crack, cloud):
    r = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), status="reviewed")
    c = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), status="closed")
    assert r.reviewed_at is not None and r.closed_at is None
    assert c.closed_at is not None


def test_an_object_type_cannot_carry_a_finding(handle, project, cloud):
    truck = project["classes"][3]  # dump_truck: an object type
    e = _refused(service.create_finding, handle, type_id=truck["id"], anchor=_at(cloud))
    assert (e.code, e.status) == ("not_a_defect", 422)


def test_a_catalogue_defect_type_not_yet_in_the_project_is_added(client, handle, project, cloud):
    rust = add_type(client, "rust")
    service.create_finding(handle, type_id=rust["id"], anchor=_at(cloud))
    ids = [c["id"] for c in client.get(f"/api/v1/projects/{project['id']}").json()["classes"]]
    assert ids[-1] == rust["id"]


def test_an_object_type_from_the_catalogue_is_not_added_on_refusal(client, handle, project, cloud):
    pole = add_type(client, "pole", kind="object")
    assert _refused(service.create_finding, handle, type_id=pole["id"], anchor=_at(cloud)).code == "not_a_defect"
    ids = [c["id"] for c in client.get(f"/api/v1/projects/{project['id']}").json()["classes"]]
    assert pole["id"] not in ids


def test_an_unknown_type_and_an_unknown_level_are_refused(handle, crack, cloud):
    assert _refused(service.create_finding, handle, type_id="nope", anchor=_at(cloud)).code == "unknown_type"
    e = _refused(service.create_finding, handle, type_id=crack["id"], anchor=_at(cloud), severity=7)
    assert (e.code, e.status) == ("severity_unknown", 422)


@pytest.mark.parametrize(
    ("path", "allowed"),
    [
        (["reviewed"], True),
        (["closed"], True),
        (["reviewed", "closed"], True),
        (["reviewed", "open"], True),
        (["closed", "open"], True),
        (["closed", "reviewed"], False),
    ],
)
def test_status_transitions(handle, crack, cloud, path, allowed):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    *head, last = path
    for status in head:
        service.patch_finding(handle, f.id, {"status": status})
    if allowed:
        assert service.patch_finding(handle, f.id, {"status": last}).status == last
    else:
        e = _refused(service.patch_finding, handle, f.id, {"status": last})
        assert (e.code, e.status) == ("invalid_transition", 409)


def test_transition_timestamps(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    assert service.patch_finding(handle, f.id, {"status": "reviewed"}).reviewed_at is not None
    assert service.patch_finding(handle, f.id, {"status": "open"}).reviewed_at is None
    assert service.patch_finding(handle, f.id, {"status": "closed"}).closed_at is not None
    assert service.patch_finding(handle, f.id, {"status": "open"}).closed_at is None


def test_severity_is_never_required_for_a_transition(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=None)
    assert service.patch_finding(handle, f.id, {"status": "closed"}).severity is None


def test_writes_record_activity_and_move_the_counts(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    service.patch_finding(handle, f.id, {"status": "reviewed"})
    service.patch_finding(handle, f.id, {"severity": 4})
    with handle.session() as s:
        rows = s.execute(select(Activity).where(Activity.subject_id == f.id).order_by(Activity.at, Activity.kind)).scalars().all()
        kinds = sorted(a.kind for a in rows)
        assert all("F-0001" in a.summary for a in rows)
    assert kinds == ["finding.created", "finding.severity", "finding.status"]
    assert _counts(handle) == {("reviewed", 4, crack["id"]): 1}


def test_a_map_anchor_takes_its_location_from_the_map_crs(handle, crack):
    from pyproj import CRS

    mid = insert_map(handle, crs_wkt=CRS.from_epsg(32633).to_wkt())
    geometry = {"type": "Point", "coordinates": [500000.0, 5000000.0]}
    f = service.create_finding(handle, type_id=crack["id"], anchor=AnchorIn(kind="map", map_id=mid, geometry=geometry))
    assert f.lon == pytest.approx(15.0, abs=1e-6) and 45.0 < f.lat < 45.3
    assert (f.data_type, f.data_id, f.geometry) == ("map", mid, geometry)


def test_a_map_anchor_without_a_crs_has_no_location(handle, crack):
    mid = insert_map(handle)
    ring = [[0, 0], [10, 0], [10, 10], [0, 0]]
    f = service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="map", map_id=mid, geometry={"type": "Polygon", "coordinates": [ring]})
    )
    assert (f.lon, f.lat) == (None, None)


def test_a_map_anchor_needs_a_point_or_a_closed_polygon(handle, crack):
    mid = insert_map(handle)
    open_ring = {"type": "Polygon", "coordinates": [[[0, 0], [10, 0], [10, 10]]]}
    e = _refused(service.create_finding, handle, type_id=crack["id"], anchor=AnchorIn(kind="map", map_id=mid, geometry=open_ring))
    assert (e.code, e.status) == ("invalid_geometry", 422)


def test_a_missing_anchor_target_is_404(handle, crack):
    assert _refused(service.create_finding, handle, type_id=crack["id"], anchor=_at("nope")).status == 404


def test_the_database_refuses_a_mixed_anchor(handle, crack, cloud):
    with pytest.raises(IntegrityError), handle.session() as s:
        s.add(
            Finding(
                number=99,
                type_id=crack["id"],
                status="open",
                note="",
                created_by="human",
                anchor_kind="cloud",
                cloud_id=cloud,
                x=0.0,
                y=0.0,
                z=0.0,
                map_id="m1",
                data_type="point_cloud",
                data_id=cloud,
            )
        )
        s.flush()


def test_moving_a_cloud_anchor(handle, crack, cloud):
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    moved = service.patch_finding(handle, f.id, {"anchor": {"x": 9.0, "uncertainty_m": 0.05}})
    assert (moved.x, moved.y, moved.uncertainty_m) == (9.0, 2.0, 0.05)


def test_findings_work_on_snapshot_types_without_the_catalogue(client, handle, crack, cloud):
    handle.catalogue = None
    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud), severity=3)
    assert service.patch_finding(handle, f.id, {"status": "reviewed", "severity": 9}).severity == 9
    rust = add_type(client, "rust")
    e = _refused(service.create_finding, handle, type_id=rust["id"], anchor=_at(cloud))
    assert (e.code, e.status) == ("catalogue_unavailable", 503)


def test_delete_for_anchor_takes_every_finding_of_that_target(handle, crack, cloud):
    other = insert_cloud(handle, name="Other")
    a = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    b = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    keep = service.create_finding(handle, type_id=crack["id"], anchor=_at(other))
    with handle.session() as s:
        gone = service.delete_for_anchor(s, project_id=handle.id, anchor_kind="cloud", target_id=cloud)
    assert sorted(gone) == sorted([a.id, b.id])
    assert _counts(handle) == {("open", 2, crack["id"]): 1}
    assert service.get_finding(handle, keep.id)[0].id == keep.id


def test_a_deleted_findings_photos_go_to_the_trash_and_are_purged_after_30_days(handle, crack, cloud):
    from datetime import UTC, datetime, timedelta

    f = service.create_finding(handle, type_id=crack["id"], anchor=_at(cloud))
    folder = trash.finding_dir(handle, f.id)
    folder.mkdir(parents=True)
    (folder / "a.jpg").write_bytes(b"x")
    service.delete_finding(handle, f.id)
    binned = list((handle.folder / "findings" / "_trash").glob(f"{f.id}-*"))
    assert len(binned) == 1 and (binned[0] / "a.jpg").read_bytes() == b"x"
    assert trash.purge(handle, now=datetime.now(UTC) + timedelta(days=29)) == 0
    assert trash.purge(handle, now=datetime.now(UTC) + timedelta(days=31)) == 1
    assert not binned[0].exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_service.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.findings.anchors'`.

- [ ] **Step 3: Anchors and trash**

`backend/app/findings/anchors.py`:
```python
"""Finding anchors (spec 2026-09-26-foundation section 8.1): exactly one of an image annotation, a
map geometry in the map's CRS, or a cloud point in the cloud's CRS. `resolve` checks the target
exists and returns the finding's anchor columns, its data item (for filters) and its WGS84 location
(for the Overview's pins)."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Box, Finding, GeoMap, Image, PointCloud
from app.errors import AppError, not_found
from app.findings.numbers import format_number

log = logging.getLogger(__name__)
KINDS = ("image", "map", "cloud")
_EMPTY = dict.fromkeys(("image_id", "annotation_id", "map_id", "geometry", "cloud_id", "x", "y", "z", "uncertainty_m"))


@dataclass
class AnchorIn:
    kind: str  # image | map | cloud
    image_id: str | None = None
    annotation_id: str | None = None
    box: dict | None = None  # {x, y, w, h, angle}: POST /findings draws the box (Task 11)
    map_id: str | None = None
    geometry: dict | None = None
    cloud_id: str | None = None
    x: float | None = None
    y: float | None = None
    z: float | None = None
    uncertainty_m: float | None = None


def _finite(*values) -> bool:
    return all(v is not None and math.isfinite(v) for v in values)


def _invalid(message: str) -> AppError:
    return AppError("invalid_geometry", message, 422)


def check_geometry(geometry) -> dict:
    """A GeoJSON Point, or a Polygon whose one ring is closed and has at least four positions."""
    try:
        kind = geometry["type"]
        coords = geometry["coordinates"]
        if kind == "Point":
            points = [coords]
        elif kind == "Polygon":
            points = coords[0]
            if len(points) < 4 or list(points[0]) != list(points[-1]):
                raise ValueError("the ring is not closed")
        else:
            raise ValueError(kind)
        clean = [[float(p[0]), float(p[1])] for p in points]
        if not all(math.isfinite(v) for p in clean for v in p):
            raise ValueError("not finite")
    except (KeyError, TypeError, ValueError, IndexError):
        raise _invalid("A map anchor needs a GeoJSON Point or a closed Polygon.") from None
    return {"type": kind, "coordinates": clean[0] if kind == "Point" else [clean]}


def centroid(geometry: dict) -> tuple[float, float]:
    if geometry["type"] == "Point":
        x, y = geometry["coordinates"]
        return float(x), float(y)
    ring = geometry["coordinates"][0][:-1]
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def to_wgs84(crs_wkt: str | None, x: float, y: float) -> tuple[float | None, float | None]:
    """A native point in WGS84, or (None, None) without a CRS or when projecting fails: a finding
    without a location is still a finding; it just has no pin."""
    if not crs_wkt:
        return None, None
    try:
        from pyproj import CRS, Transformer

        t = Transformer.from_crs(CRS.from_wkt(crs_wkt), CRS.from_epsg(4326), always_xy=True)
        lon, lat = t.transform(x, y)
    except Exception:
        log.warning("could not place (%s, %s) in WGS84", x, y, exc_info=True)
        return None, None
    return (float(lon), float(lat)) if _finite(lon, lat) else (None, None)


def _image(s: Session, a: AnchorIn) -> dict:
    image = s.get(Image, a.image_id) if a.image_id else None
    if image is None:
        raise not_found("image", str(a.image_id))
    box = s.get(Box, a.annotation_id) if a.annotation_id else None
    if box is None or box.image_id != image.id:
        raise not_found("annotation", str(a.annotation_id))
    taken = s.execute(select(Finding.id, Finding.number).where(Finding.annotation_id == box.id)).first()
    if taken is not None:
        raise AppError(
            "annotation_has_finding",
            f"That annotation is already {format_number(taken.number)}.",
            409,
            {"finding_id": taken.id},
        )
    return {
        **_EMPTY,
        "anchor_kind": "image",
        "image_id": image.id,
        "annotation_id": box.id,
        "lon": image.lon,
        "lat": image.lat,
        "data_type": "image_set",
        "data_id": image.source_id,
    }


def _map(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    gmap = s.get(GeoMap, a.map_id) if a.map_id else None
    if gmap is None:
        raise not_found("map", str(a.map_id))
    geometry = check_geometry(a.geometry)
    if not _finite(lon, lat):
        lon, lat = to_wgs84(gmap.crs_wkt, *centroid(geometry))
    return {
        **_EMPTY,
        "anchor_kind": "map",
        "map_id": gmap.id,
        "geometry": geometry,
        "lon": lon,
        "lat": lat,
        "data_type": "map",
        "data_id": gmap.id,
    }


def _cloud(s: Session, a: AnchorIn, lon: float | None, lat: float | None) -> dict:
    cloud = s.get(PointCloud, a.cloud_id) if a.cloud_id else None
    if cloud is None:
        raise not_found("point cloud", str(a.cloud_id))
    if not _finite(a.x, a.y, a.z):
        raise _invalid("A cloud anchor needs finite x, y and z.")
    if a.uncertainty_m is not None and not (math.isfinite(a.uncertainty_m) and a.uncertainty_m >= 0):
        raise _invalid("uncertainty_m must be a finite number of metres, 0 or more.")
    if not _finite(lon, lat):
        lon, lat = to_wgs84(cloud.crs_wkt, a.x, a.y)
    return {
        **_EMPTY,
        "anchor_kind": "cloud",
        "cloud_id": cloud.id,
        "x": float(a.x),
        "y": float(a.y),
        "z": float(a.z),
        "uncertainty_m": a.uncertainty_m,
        "lon": lon,
        "lat": lat,
        "data_type": "point_cloud",
        "data_id": cloud.id,
    }


def resolve(s: Session, anchor: AnchorIn, *, lon: float | None = None, lat: float | None = None) -> dict:
    """The finding columns for `anchor`. A map or cloud caller may pass its own `lon`/`lat` (M's map
    review does, spec section 8.5); otherwise they are projected from the target's CRS."""
    if anchor.kind == "image":
        return _image(s, anchor)
    if anchor.kind == "map":
        return _map(s, anchor, lon, lat)
    if anchor.kind == "cloud":
        return _cloud(s, anchor, lon, lat)
    raise AppError("validation_error", f"unknown anchor kind {anchor.kind!r}", 422)


def repatch(s: Session, row: Finding, patch: dict) -> dict:
    """The column changes for PATCH `anchor`: a map finding's geometry or a cloud finding's point.
    An image finding moves with its box, never through here."""
    if row.anchor_kind == "image":
        raise AppError("anchor_immutable", "An image finding moves with its annotation; edit the box.", 422)
    if row.anchor_kind == "map":
        if patch.get("geometry") is None:
            return {}
        cols = _map(s, AnchorIn(kind="map", map_id=row.map_id, geometry=patch["geometry"]), None, None)
        return {k: cols[k] for k in ("geometry", "lon", "lat")}
    moved = AnchorIn(
        kind="cloud",
        cloud_id=row.cloud_id,
        x=patch.get("x", row.x),
        y=patch.get("y", row.y),
        z=patch.get("z", row.z),
        uncertainty_m=patch.get("uncertainty_m", row.uncertainty_m),
    )
    cols = _cloud(s, moved, None, None)
    return {k: cols[k] for k in ("x", "y", "z", "uncertainty_m", "lon", "lat")}
```

`backend/app/findings/trash.py`:
```python
"""Where a deleted finding's photos go (spec 2026-09-26-foundation section 8.5):
`findings/_trash/`, purged after 30 days. Files move only after the deleting transaction commits, so
a rolled-back delete never loses a photo."""

import logging
import os
import shutil
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path

TRASH = "_trash"
KEEP_DAYS = 30
STAMP = "%Y%m%dT%H%M%SZ"
log = logging.getLogger(__name__)


def findings_dir(handle) -> Path:
    return handle.folder / "findings"


def finding_dir(handle, finding_id: str) -> Path:
    return findings_dir(handle) / finding_id


def _stamp(now: datetime | None) -> str:
    return (now or datetime.now(UTC)).strftime(STAMP)


def move(handle, finding_ids: Iterable[str], now: datetime | None = None) -> int:
    """Each finding's folder -> `_trash/<finding_id>-<UTC stamp>`; returns how many moved."""
    moved = 0
    for fid in finding_ids:
        src = finding_dir(handle, fid)
        if not src.is_dir():
            continue
        dest = findings_dir(handle) / TRASH / f"{fid}-{_stamp(now)}"
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            os.replace(src, dest)
            moved += 1
        except OSError:
            log.exception("could not move %s to the trash", src)
    return moved


def move_file(handle, rel_path: str, now: datetime | None = None) -> None:
    """One attachment -> `_trash/<finding_id>-<UTC stamp>/<file>`."""
    src = handle.folder / rel_path
    if not src.is_file():
        return
    dest = findings_dir(handle) / TRASH / f"{src.parent.name}-{_stamp(now)}" / src.name
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dest)
    except OSError:
        log.exception("could not move %s to the trash", src)


def purge(handle, now: datetime | None = None, keep_days: int = KEEP_DAYS) -> int:
    """Remove trash entries older than `keep_days`; returns how many went. Runs on project open."""
    root = findings_dir(handle) / TRASH
    if not root.is_dir():
        return 0
    cutoff = (now or datetime.now(UTC)) - timedelta(days=keep_days)
    removed = 0
    for entry in root.iterdir():
        try:
            when = datetime.strptime(entry.name.rsplit("-", 1)[-1], STAMP).replace(tzinfo=UTC)
        except ValueError:
            continue
        if when >= cutoff:
            continue
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)
        removed += 1
    return removed
```

- [ ] **Step 4: The service**

`backend/app/findings/service.py`:
```python
"""Findings: create, change, delete (spec 2026-09-26-foundation sections 8.1-8.3, 8.5).

`create_in_session` is the public entry for every write path that creates findings inside its own
transaction: the box hooks (findings/annotations.py), the backfill, and M's map review (M section
9.3). Every write calls `counts.change` and `events.mark_changed` in the caller's transaction.
Everything a write checks is checked before anything changes, so `bulk` can skip a refusal cleanly.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.catalogue import project_types
from app.catalogue import service as catalogue_service
from app.db.base import utcnow
from app.db.models import Finding, FindingAttachment, FindingComment, ProjectType
from app.errors import AppError, not_found
from app.findings import activity, anchors, counts, events, numbers, trash
from app.findings.anchors import AnchorIn

STATUSES = ("open", "reviewed", "closed")
TRANSITIONS = {
    ("open", "reviewed"),
    ("open", "closed"),
    ("reviewed", "closed"),
    ("reviewed", "open"),
    ("closed", "open"),
}
UNSET: Any = object()


def _get(s: Session, finding_id: str) -> Finding:
    row = s.get(Finding, finding_id)
    if row is None:
        raise not_found("finding", finding_id)
    return row


def _sev_text(level: int | None) -> str:
    return "none" if level is None else str(level)


def defect_type(s: Session, catalogue, type_id: str) -> ProjectType:
    """The project's snapshot of a defect type. A catalogue defect type not in the list yet is added
    (like a run's mapped types, spec section 7.4); an object type is refused before anything is
    written (D7)."""
    row = s.get(ProjectType, type_id)
    if row is None:
        ref = project_types.lookup_types(catalogue, [type_id])[type_id]
        if ref.kind != "defect":
            raise AppError(
                "not_a_defect", f"{ref.name} is an object type; findings are defects only.", 422, {"type_id": type_id}
            )
        project_types.add_types(s, catalogue, [type_id])
        row = s.get(ProjectType, type_id)
    if row.kind != "defect":
        raise AppError(
            "not_a_defect", f"{row.name} is an object type; findings are defects only.", 422, {"type_id": type_id}
        )
    return row


def check_severity(catalogue, level: int | None) -> None:
    """A level on the scale; without a catalogue any of 1-9 (the scale's bound) is taken."""
    if level is None:
        return
    levels = [lv.level for lv in catalogue_service.get_scale(catalogue)] if catalogue is not None else range(1, 10)
    if level not in levels:
        raise AppError("severity_unknown", f"There is no severity level {level}.", 422, {"level": level})


def create_in_session(
    s: Session,
    *,
    project_id: str,
    catalogue,
    type_id: str,
    anchor: AnchorIn,
    severity: int | None = UNSET,
    note: str = "",
    status: str = "open",
    created_by: str = "human",
    confidence: float | None = None,
    lon: float | None = None,
    lat: float | None = None,
    created_at: datetime | None = None,
    number: int | None = None,
    record_activity: bool = True,
) -> Finding:
    """Create one finding in the caller's transaction. `severity` defaults to the type's default
    severity; pass None for "no severity". `number` is for callers that reserved a range with
    `numbers.allocate(s, count=n)` (the backfill)."""
    if status not in STATUSES:
        raise AppError("validation_error", f"unknown status {status!r}", 422)
    pt = defect_type(s, catalogue, type_id)
    if severity is UNSET:
        severity = pt.default_severity
    else:
        check_severity(catalogue, severity)
    columns = anchors.resolve(s, anchor, lon=lon, lat=lat)
    now = utcnow()
    row = Finding(
        number=number if number is not None else numbers.allocate(s),
        type_id=type_id,
        severity=severity,
        status=status,
        note=note,
        created_by=created_by,
        confidence=confidence,
        created_at=created_at or now,
        updated_at=now,
        reviewed_at=now if status == "reviewed" else None,
        closed_at=now if status == "closed" else None,
        **columns,
    )
    s.add(row)
    s.flush()
    counts.change(s, None, counts.key_of(row))
    if record_activity:
        activity.record(
            s,
            "finding.created",
            row.id,
            f"{numbers.format_number(row.number)} {pt.name} created",
            {"number": row.number, "type_id": type_id},
        )
    events.mark_changed(s, project_id, [row.id])
    return row


def patch_in_session(s: Session, *, project_id: str, catalogue, finding_id: str, fields: Mapping[str, Any]) -> Finding:
    """Apply `fields` (`status`, `severity`, `type_id`, `note`, `anchor`) under spec section 8.2."""
    row = _get(s, finding_id)
    old = counts.key_of(row)
    label = numbers.format_number(row.number)
    status = fields.get("status") or row.status
    if status not in STATUSES:
        raise AppError("validation_error", f"unknown status {status!r}", 422)
    if status != row.status and (row.status, status) not in TRANSITIONS:
        raise AppError(
            "invalid_transition",
            f"{label} is {row.status}; it cannot become {status} directly. Reopen it first.",
            409,
            {"from": row.status, "to": status},
        )
    if "severity" in fields:
        check_severity(catalogue, fields["severity"])
    new_type = fields.get("type_id")
    pt = defect_type(s, catalogue, new_type) if new_type and new_type != row.type_id else None
    moved = anchors.repatch(s, row, fields["anchor"]) if fields.get("anchor") is not None else {}

    now = utcnow()
    if status != row.status:
        activity.record(s, "finding.status", row.id, f"{label} {row.status} → {status}", {"from": row.status, "to": status})
        if status == "reviewed":
            row.reviewed_at = now
        elif status == "closed":
            row.closed_at = now
        elif row.status == "reviewed":  # reviewed -> open
            row.reviewed_at = None
        else:  # closed -> open (reopen)
            row.closed_at = None
        row.status = status
    if "severity" in fields and fields["severity"] != row.severity:
        activity.record(
            s,
            "finding.severity",
            row.id,
            f"{label} severity {_sev_text(row.severity)} → {_sev_text(fields['severity'])}",
            {"from": row.severity, "to": fields["severity"]},
        )
        row.severity = fields["severity"]
    if pt is not None:
        row.type_id = pt.type_id
    if "note" in fields and fields["note"] is not None:
        row.note = fields["note"]
    for key, value in moved.items():
        setattr(row, key, value)
    row.updated_at = now
    s.flush()
    counts.change(s, old, counts.key_of(row))
    events.mark_changed(s, project_id, [row.id])
    return row


def delete_in_session(s: Session, *, project_id: str, finding_id: str, delete_annotation: bool = True) -> str:
    """Delete one finding; its attachment and comment rows go by ON DELETE CASCADE. The caller moves
    its files to the trash after commit (`trash.move`)."""
    row = _get(s, finding_id)
    counts.change(s, counts.key_of(row), None)
    s.delete(row)
    s.flush()  # the finding goes before the box it references
    events.mark_changed(s, project_id, [finding_id])
    return finding_id


def delete_for_anchor(s: Session, *, project_id: str, anchor_kind: str, target_id: str) -> list[str]:
    """Every finding anchored on one image, map or cloud; for M and C when they delete a map or a
    cloud (their deletes are theirs). The caller moves the returned ids' files after commit."""
    column = {"image": Finding.image_id, "map": Finding.map_id, "cloud": Finding.cloud_id}[anchor_kind]
    ids = list(s.execute(select(Finding.id).where(Finding.anchor_kind == anchor_kind, column == target_id)).scalars())
    for fid in ids:
        delete_in_session(s, project_id=project_id, finding_id=fid, delete_annotation=False)
    return ids


def create_finding(handle, **kw) -> Finding:
    """`create_in_session` in its own transaction (the HTTP route)."""
    with handle.session() as s:
        row = create_in_session(s, project_id=handle.id, catalogue=handle.catalogue, **kw)
        s.flush()
        s.expunge(row)
    return row


def get_finding(handle, finding_id: str) -> tuple[Finding, int, int]:
    """The finding with its attachment and comment counts."""
    with handle.session() as s:
        row = _get(s, finding_id)
        n_att = s.execute(
            select(func.count()).select_from(FindingAttachment).where(FindingAttachment.finding_id == finding_id)
        ).scalar_one()
        n_com = s.execute(
            select(func.count()).select_from(FindingComment).where(FindingComment.finding_id == finding_id)
        ).scalar_one()
        s.expunge(row)
    return row, n_att, n_com


def patch_finding(handle, finding_id: str, fields: Mapping[str, Any]) -> Finding:
    with handle.session() as s:
        row = patch_in_session(s, project_id=handle.id, catalogue=handle.catalogue, finding_id=finding_id, fields=fields)
        s.flush()
        s.expunge(row)
    return row


def delete_finding(handle, finding_id: str) -> None:
    with handle.session() as s:
        delete_in_session(s, project_id=handle.id, finding_id=finding_id)
    trash.move(handle, [finding_id])
```

`delete_in_session` takes `delete_annotation` now so its signature is final; Task 11 makes it
delete the box of an image anchor.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_service.py tests/test_findings_plumbing.py -v`
Expected: all pass.

- [ ] **Step 6: Lint and commit**

```powershell
& $PY -m ruff format app/findings tests/test_findings_service.py tests/findings_helpers.py tests/conftest.py
& $PY -m ruff check app/findings tests/test_findings_service.py tests/findings_helpers.py tests/conftest.py
cd ..
git add backend/app/findings/anchors.py backend/app/findings/trash.py backend/app/findings/service.py backend/tests/findings_helpers.py backend/tests/conftest.py backend/tests/test_findings_service.py
git commit -m @'
feat(findings): create, patch and delete with transitions, anchors, numbers and counts

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 8: Findings list, bulk, summary and search

**Files:**
- Create: `backend/app/findings/query.py`
- Test: `backend/tests/test_findings_query.py`

**Interfaces:**
- Consumes: Task 7 `service.patch_in_session`, `service.create_finding`, `service.patch_finding`, `service.delete_finding`, `service.STATUSES`, `AnchorIn`; Task 6 `counts.NO_SEVERITY`, `counts.OPEN_STATES`, `counts.today`, `counts.recount`, `numbers.parse_number`; Task 2 `like_pattern`; Task 3 `Finding`, `FindingCount`, `FindingDaily`, `ProjectType`.
- Produces:
  - `FindingFilters(status=None, severity=None, type_id=None, anchor_kind=None, data_id=None, image_id=None, created_by=None, q=None, updated_from=None, updated_to=None, has_location=None)` (dataclass; `severity` holds `"1"`–`"9"` or `"none"`, `created_by` is `"human"` or `"model"`)
  - `list_findings(s, filters, *, sort="-severity", cursor=None, limit=None) -> tuple[list[Finding], str | None]`; `SORTS = ("-severity", "number", "-updated_at", "type")`; `MAX_PAGE = 500`
  - `bulk(s, *, project_id, catalogue, ids, set_fields) -> {"updated": int, "skipped": [{"id", "code"}]}`; `MAX_BULK = 1000`
  - `summary(s, *, day=None, levels=()) -> dict` (the `FindingSummary` shape of the Task 1 table: `open_by_severity` is `{"<level>": n}`, `by_type` is `[{type_id, n}]`); `trend(s, day) -> list[dict]` (60 days, oldest first)
  - `search_findings(s, q, limit=8) -> list[Finding]`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_query.py`:
```python
"""Reading findings (spec 2026-09-26-foundation sections 8.3, 8.4, 16): filters, sorts, a keyset
cursor that holds while findings arrive, bulk with skips, the pre-aggregated summary, and the
seeded random property test that the counts always equal a recount."""

import random
from datetime import UTC, date, datetime, timedelta

import pytest
from findings_helpers import add_type, insert_cloud, insert_map, use_types
from sqlalchemy import select

from app.db.models import Finding, FindingCount, FindingDaily
from app.errors import AppError
from app.findings import counts, query, service
from app.findings.anchors import AnchorIn


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _make(handle, type_id: str, cloud_id: str, **kw) -> Finding:
    return service.create_finding(
        handle, type_id=type_id, anchor=AnchorIn(kind="cloud", cloud_id=cloud_id, x=0.0, y=0.0, z=0.0), **kw
    )


def _list(handle, sort: str = "-severity", limit: int | None = None, cursor: str | None = None, **filters):
    with handle.session() as s:
        rows, nxt = query.list_findings(s, query.FindingFilters(**filters), sort=sort, cursor=cursor, limit=limit)
        return [r.number for r in rows], nxt


def _counts(s) -> dict:
    return {(r.status, r.severity, r.type_id): r.n for r in s.execute(select(FindingCount)).scalars() if r.n}


def test_the_default_sort_is_severity_high_first_then_newest(handle, crack, cloud):
    for sev in [None, 1, 4, 4, 2]:
        _make(handle, crack["id"], cloud, severity=sev)
    assert _list(handle)[0] == [4, 3, 5, 2, 1]


def test_the_other_sorts(client, handle, crack, cloud):
    rust = add_type(client, "rust")
    a = _make(handle, crack["id"], cloud)
    _make(handle, rust["id"], cloud)
    _make(handle, crack["id"], cloud)
    assert _list(handle, sort="number")[0] == [1, 2, 3]
    with handle.session() as s:
        s.get(Finding, a.id).updated_at = datetime.now(UTC) + timedelta(minutes=1)
    assert _list(handle, sort="-updated_at")[0][0] == 1
    assert _list(handle, sort="type")[0] == [1, 3, 2]  # crack before rust


def test_filters(client, handle, crack, cloud):
    rust = add_type(client, "rust")
    _make(handle, crack["id"], cloud, severity=None, note="hairline near joint")
    f2 = _make(handle, rust["id"], cloud, severity=3)
    _make(handle, crack["id"], cloud, severity=1, created_by="model:m1", confidence=0.8)
    service.patch_finding(handle, f2.id, {"status": "closed"})
    mid = insert_map(handle)
    point = {"type": "Point", "coordinates": [1.0, 2.0]}
    service.create_finding(
        handle, type_id=crack["id"], anchor=AnchorIn(kind="map", map_id=mid, geometry=point), lon=15.0, lat=45.0
    )
    assert _list(handle, status=["closed"])[0] == [2]
    assert _list(handle, severity=["none"])[0] == [1]
    assert sorted(_list(handle, severity=["1", "none"])[0]) == [1, 3]
    assert _list(handle, type_id=[rust["id"]])[0] == [2]
    assert _list(handle, anchor_kind=["map"])[0] == [4]
    assert _list(handle, data_id=mid)[0] == [4]
    assert _list(handle, created_by="model")[0] == [3]
    assert sorted(_list(handle, created_by="human")[0]) == [1, 2, 4]
    assert _list(handle, has_location=True)[0] == [4]
    assert _list(handle, q="hairline")[0] == [1]
    assert _list(handle, q="RUST")[0] == [2]
    assert _list(handle, q="F-0003")[0] == [3]
    assert _list(handle, updated_from=datetime.now(UTC) + timedelta(days=1))[0] == []


def test_like_wildcards_match_literally(handle, crack, cloud):
    for note in ["100% corroded", "1000 mm", "ZG_04 joint", "ZGX04 joint"]:
        _make(handle, crack["id"], cloud, note=note)
    assert _list(handle, q="100%")[0] == [1]
    assert _list(handle, q="ZG_04")[0] == [3]


def test_paging_is_stable_while_findings_arrive(handle, crack, cloud):
    for sev in [1, 2, 3, 4, 1, 2]:
        _make(handle, crack["id"], cloud, severity=sev)
    first, cursor = _list(handle, limit=2)
    assert first == [4, 3]
    _make(handle, crack["id"], cloud, severity=4)  # F-0007 sorts before the cursor
    _make(handle, crack["id"], cloud, severity=1)  # F-0008 sorts after it
    rest: list[int] = []
    while cursor:
        page, cursor = _list(handle, limit=2, cursor=cursor)
        rest += page
    assert rest == [6, 2, 8, 5, 1]


def test_a_cursor_from_another_sort_is_refused(handle, crack, cloud):
    for _ in range(3):
        _make(handle, crack["id"], cloud)
    _, cursor = _list(handle, limit=1)
    with pytest.raises(AppError) as e:
        _list(handle, sort="number", cursor=cursor)
    assert e.value.status == 422


def test_bulk_updates_and_reports_skips(client, handle, project, crack, cloud):
    a = _make(handle, crack["id"], cloud)
    b = _make(handle, crack["id"], cloud)
    c = _make(handle, crack["id"], cloud)
    service.patch_finding(handle, c.id, {"status": "closed"})
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=[a.id, b.id, c.id, "nope"],
            set_fields={"status": "reviewed", "severity": 3},
        )
    assert result == {
        "updated": 2,
        "skipped": [{"id": c.id, "code": "invalid_transition"}, {"id": "nope", "code": "not_found"}],
    }
    with handle.session() as s:
        assert _counts(s) == {("reviewed", 3, crack["id"]): 2, ("closed", 2, crack["id"]): 1}
    pole = add_type(client, "pole", kind="object")
    use_types(client, project, pole)
    with handle.session() as s:
        result = query.bulk(s, project_id=handle.id, catalogue=handle.catalogue, ids=[a.id], set_fields={"type_id": pole["id"]})
    assert result == {"updated": 0, "skipped": [{"id": a.id, "code": "not_a_defect"}]}


def test_summary_reads_the_counts(handle, crack, cloud, monkeypatch):
    monkeypatch.setattr(counts, "today", lambda: date(2026, 9, 26))
    _make(handle, crack["id"], cloud, severity=None)
    _make(handle, crack["id"], cloud, severity=4)
    r = _make(handle, crack["id"], cloud, severity=4)
    c = _make(handle, crack["id"], cloud, severity=2)
    service.patch_finding(handle, r.id, {"status": "reviewed"})
    service.patch_finding(handle, c.id, {"status": "closed"})
    with handle.session() as s:
        out = query.summary(s, levels=[1, 2, 3, 4])
    assert out["by_status"] == {"open": 2, "reviewed": 1, "closed": 1}
    assert out["open_by_severity"] == {"1": 0, "2": 0, "3": 0, "4": 2}
    assert out["open_no_severity"] == 1
    assert out["by_type"] == [{"type_id": crack["id"], "n": 3}]
    trend = out["trend"]
    assert len(trend) == 60 and trend[-1]["day"] == date(2026, 9, 26)
    assert (trend[-1]["open"], trend[-1]["closed"]) == (3, 1)
    assert trend[0]["open"] == 0


def test_the_trend_carries_the_last_known_day_forward(handle):
    with handle.session() as s:
        s.add(FindingDaily(day=date(2026, 9, 1), open=5, open_by_severity={"2": 5}, closed=0, closed_by_severity={}))
        s.add(FindingDaily(day=date(2026, 9, 20), open=3, open_by_severity={"2": 3}, closed=2, closed_by_severity={"2": 2}))
    with handle.session() as s:
        by_day = {t["day"]: t for t in query.trend(s, date(2026, 9, 26))}
    assert by_day[date(2026, 8, 20)]["open"] == 0
    assert by_day[date(2026, 9, 10)]["open"] == 5
    assert (by_day[date(2026, 9, 20)]["open"], by_day[date(2026, 9, 20)]["closed"]) == (3, 2)
    assert (by_day[date(2026, 9, 26)]["open"], by_day[date(2026, 9, 26)]["closed"]) == (3, 0)
    assert by_day[date(2026, 9, 26)]["open_by_severity"] == {"2": 3}


def test_search_findings(handle, crack, cloud):
    _make(handle, crack["id"], cloud, note="spalling at pier 3")
    _make(handle, crack["id"], cloud)
    with handle.session() as s:
        assert [f.number for f in query.search_findings(s, "pier")] == [1]
        assert [f.number for f in query.search_findings(s, "crack")] == [2, 1]
        assert [f.number for f in query.search_findings(s, "F-0002")] == [2]
        assert query.search_findings(s, "   ") == []


@pytest.mark.parametrize("seed", range(10))
def test_counts_equal_a_recount_after_random_writes(client, handle, crack, cloud, seed):
    rust = add_type(client, "rust")
    rng = random.Random(seed)
    types = [crack["id"], rust["id"]]
    live: list[str] = []
    for _ in range(40):
        op = rng.choice(["create", "create", "patch", "bulk", "delete"])
        try:
            if op == "create" or not live:
                f = _make(
                    handle,
                    rng.choice(types),
                    cloud,
                    severity=rng.choice([None, 1, 2, 3, 4]),
                    status=rng.choice(service.STATUSES),
                )
                live.append(f.id)
            elif op == "patch":
                fields = rng.choice(
                    [{"status": rng.choice(service.STATUSES)}, {"severity": rng.choice([None, 1, 4])}, {"type_id": rng.choice(types)}]
                )
                service.patch_finding(handle, rng.choice(live), fields)
            elif op == "bulk":
                with handle.session() as s:
                    query.bulk(
                        s,
                        project_id=handle.id,
                        catalogue=handle.catalogue,
                        ids=rng.sample(live, k=min(len(live), 3)),
                        set_fields={"status": rng.choice(service.STATUSES), "severity": rng.choice([None, 2])},
                    )
            else:
                service.delete_finding(handle, live.pop(rng.randrange(len(live))))
        except AppError as e:
            assert e.code == "invalid_transition", e.code
    with handle.session() as s:
        incremental = _counts(s)
        open_today = s.get(FindingDaily, counts.today()).open
        counts.recount(s)
        s.flush()
        assert incremental == _counts(s)
        assert open_today == s.get(FindingDaily, counts.today()).open
        s.rollback()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_query.py -v`
Expected: collection error `ImportError: cannot import name 'query' from 'app.findings'`.

- [ ] **Step 3: Implement**

`backend/app/findings/query.py`:
```python
"""Reading findings (spec 2026-09-26-foundation sections 8.3, 10.3): the filtered, keyset-paged list
behind the Findings tab, bulk edits, the pre-aggregated summary and in-project search.

Every sort has a total order (ties broken by `number`), and the cursor carries the sort's key of the
last row, so a page boundary holds while findings are created or change: a row that newly sorts
before the cursor is not shown in later pages, and none is shown twice.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.catalogue.names import like_pattern
from app.db.models import Finding, FindingCount, FindingDaily, ProjectType
from app.errors import AppError
from app.findings import counts, numbers, service
from app.pagination import clamp_limit, decode_cursor, encode_cursor

SORTS = ("-severity", "number", "-updated_at", "type")
MAX_PAGE = 500
MAX_BULK = 1000
TREND_DAYS = 60
TOP_TYPES = 10


@dataclass
class FindingFilters:
    status: list[str] | None = None
    severity: list[str] | None = None  # "1".."9" or "none"
    type_id: list[str] | None = None
    anchor_kind: list[str] | None = None
    data_id: str | None = None
    image_id: str | None = None  # I's agreed addition (spec section 13)
    created_by: str | None = None  # human | model
    q: str | None = None
    updated_from: datetime | None = None
    updated_to: datetime | None = None
    has_location: bool | None = None


def _where(q, f: FindingFilters):
    if f.status:
        q = q.where(Finding.status.in_(f.status))
    if f.severity:
        levels = [int(v) for v in f.severity if v != "none"]
        conds = []
        if levels:
            conds.append(Finding.severity.in_(levels))
        if "none" in f.severity:
            conds.append(Finding.severity.is_(None))
        q = q.where(or_(*conds))
    if f.type_id:
        q = q.where(Finding.type_id.in_(f.type_id))
    if f.anchor_kind:
        q = q.where(Finding.anchor_kind.in_(f.anchor_kind))
    if f.data_id:
        q = q.where(Finding.data_id == f.data_id)
    if f.image_id:
        q = q.where(Finding.anchor_kind == "image", Finding.image_id == f.image_id)
    if f.created_by == "human":
        q = q.where(Finding.created_by == "human")
    elif f.created_by == "model":
        q = q.where(Finding.created_by.like("model:%"))
    if f.updated_from is not None:
        q = q.where(Finding.updated_at >= f.updated_from)
    if f.updated_to is not None:
        q = q.where(Finding.updated_at <= f.updated_to)
    if f.has_location is True:
        q = q.where(Finding.lon.is_not(None), Finding.lat.is_not(None))
    elif f.has_location is False:
        q = q.where(or_(Finding.lon.is_(None), Finding.lat.is_(None)))
    text = (f.q or "").strip()
    if text:
        pattern = like_pattern(text)
        names = select(ProjectType.type_id).where(ProjectType.name.ilike(pattern, escape="\\"))
        conds = [Finding.note.ilike(pattern, escape="\\"), Finding.type_id.in_(names)]
        n = numbers.parse_number(text)
        if n is not None:
            conds.append(Finding.number == n)
        q = q.where(or_(*conds))
    return q


def _type_name():
    name = select(ProjectType.name).where(ProjectType.type_id == Finding.type_id).correlate(Finding).scalar_subquery()
    return func.coalesce(name, "")


def _cursor_key(sort: str, row: Finding, names: Mapping[str, str]) -> dict[str, Any]:
    if sort == "-severity":
        return {"s": counts.NO_SEVERITY if row.severity is None else row.severity}
    if sort == "-updated_at":
        return {"u": row.updated_at.isoformat()}
    if sort == "type":
        return {"t": names.get(row.type_id, "")}
    return {}


def list_findings(
    s: Session,
    filters: FindingFilters,
    *,
    sort: str = "-severity",
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[list[Finding], str | None]:
    if sort not in SORTS:
        raise AppError("validation_error", f"sort is one of {', '.join(SORTS)}", 422)
    n = min(clamp_limit(limit), MAX_PAGE)
    q = _where(select(Finding), filters)
    c = decode_cursor(cursor, "sort", "n")
    if c and c["sort"] != sort:
        raise AppError("validation_error", "the cursor belongs to another sort order", 422)
    names: dict[str, str] = {}
    if sort == "-severity":
        sev = func.coalesce(Finding.severity, counts.NO_SEVERITY)  # "no severity" sorts last
        if c:
            q = q.where(or_(sev < c["s"], and_(sev == c["s"], Finding.number < c["n"])))
        q = q.order_by(sev.desc(), Finding.number.desc())
    elif sort == "number":
        if c:
            q = q.where(Finding.number > c["n"])
        q = q.order_by(Finding.number.asc())
    elif sort == "-updated_at":
        if c:
            at = datetime.fromisoformat(c["u"])
            q = q.where(or_(Finding.updated_at < at, and_(Finding.updated_at == at, Finding.number < c["n"])))
        q = q.order_by(Finding.updated_at.desc(), Finding.number.desc())
    else:
        tname = _type_name()
        if c:
            q = q.where(or_(tname > c["t"], and_(tname == c["t"], Finding.number > c["n"])))
        q = q.order_by(tname.asc(), Finding.number.asc())
        names = dict(s.execute(select(ProjectType.type_id, ProjectType.name)).all())
    rows = s.execute(q.limit(n + 1)).scalars().all()
    nxt = None
    if len(rows) > n:
        last = rows[n - 1]
        nxt = encode_cursor(sort=sort, n=last.number, **_cursor_key(sort, last, names))
    return list(rows[:n]), nxt


def bulk(s: Session, *, project_id: str, catalogue, ids: Sequence[str], set_fields: Mapping[str, Any]) -> dict:
    """One transaction; a finding the change cannot apply to is skipped with its error code
    (spec section 8.3). `patch_in_session` checks before it writes, so a skip leaves nothing behind."""
    if len(ids) > MAX_BULK:
        raise AppError("validation_error", f"at most {MAX_BULK} findings at a time", 422)
    updated, skipped = 0, []
    for fid in dict.fromkeys(ids):
        try:
            service.patch_in_session(s, project_id=project_id, catalogue=catalogue, finding_id=fid, fields=dict(set_fields))
            updated += 1
        except AppError as e:
            if e.status >= 500:  # the catalogue is down: nothing in the batch can be trusted
                raise
            skipped.append({"id": fid, "code": e.code})
    return {"updated": updated, "skipped": skipped}


def trend(s: Session, day: date) -> list[dict]:
    """The last 60 days, oldest first. A day without a row carries the last known open numbers
    forward (nothing changed that day) and has no closures."""
    since = day - timedelta(days=TREND_DAYS - 1)
    rows = {
        r.day: r
        for r in s.execute(select(FindingDaily).where(FindingDaily.day >= since, FindingDaily.day <= day)).scalars()
    }
    prior = s.execute(
        select(FindingDaily).where(FindingDaily.day < since).order_by(FindingDaily.day.desc()).limit(1)
    ).scalar_one_or_none()
    open_, by = (prior.open, dict(prior.open_by_severity or {})) if prior is not None else (0, {})
    out = []
    for i in range(TREND_DAYS):
        d = since + timedelta(days=i)
        r = rows.get(d)
        if r is not None:
            open_, by = r.open, dict(r.open_by_severity or {})
        out.append(
            {
                "day": d,
                "open": open_,
                "closed": r.closed if r is not None else 0,
                "open_by_severity": dict(sorted(by.items(), key=lambda kv: int(kv[0]))),
            }
        )
    return out


def summary(s: Session, *, day: date | None = None, levels: Sequence[int] = ()) -> dict:
    """`finding_count` and `finding_daily` only: three small reads, whatever the number of findings
    (spec section 8.3). "Open" means not closed. `levels` are the scale's levels, so an empty level
    still gets its (zero) bar. Type names and colours come from the project's type list client-side."""
    rows = s.execute(
        select(FindingCount.status, FindingCount.severity, FindingCount.type_id, FindingCount.n).where(FindingCount.n > 0)
    ).all()
    by_status = dict.fromkeys(service.STATUSES, 0)
    open_sev: Counter = Counter()
    open_none = 0
    by_type: Counter = Counter()
    for status, sev, type_id, n in rows:
        by_status[status] = by_status.get(status, 0) + n
        if status in counts.OPEN_STATES:
            if sev == counts.NO_SEVERITY:
                open_none += n
            else:
                open_sev[sev] += n
            by_type[type_id] += n
    return {
        "by_status": by_status,
        "open_by_severity": {str(lv): open_sev.get(lv, 0) for lv in sorted(set(levels) | set(open_sev))},
        "open_no_severity": open_none,
        "by_type": [{"type_id": t, "n": n} for t, n in by_type.most_common(TOP_TYPES)],
        "trend": trend(s, day or counts.today()),
    }


def search_findings(s: Session, q: str, limit: int = 8) -> list[Finding]:
    """For BK's `GET /projects/{id}/search` (spec section 10.3): the number, then note and type name,
    newest first, `LIMIT limit`."""
    text = (q or "").strip()
    if not text:
        return []
    stmt = _where(select(Finding), FindingFilters(q=text)).order_by(Finding.number.desc()).limit(limit)
    return list(s.execute(stmt).scalars())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_query.py -v`
Expected: all pass (19 with the ten property-test seeds).

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app/findings tests/test_findings_query.py
& $PY -m ruff check app/findings tests/test_findings_query.py
cd ..
git add backend/app/findings/query.py backend/tests/test_findings_query.py
git commit -m @'
feat(findings): keyset list with filters and sorts, bulk with skips, summary, search

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 9: The findings HTTP API and the recount job

**Files:**
- Create: `backend/app/findings/schemas.py`, `backend/app/findings/jobs.py`, `backend/app/findings/router.py`
- Modify: `backend/app/api.py` (include the router plainly), `backend/app/main.py` (`project_opened` step "findings counts check")
- Modify: `backend/tests/test_contract.py` (stubs and `REFUSES_VALID_DATA`)
- Test: `backend/tests/test_findings_api.py`

**Interfaces:**
- Consumes: Task 7 `service.*`, `AnchorIn`; Task 8 `query.*`; Task 6 `activity.page`, `counts.recount`; Task 2 `catalogue_service.scale_levels`; BK's `app.data_items.search.register_finding_search`; `app.jobs.registry.register_job_type`; `app.training.schemas.JobRef`, `app.jobs.schemas.JobOut`.
- Produces: the routes of spec §8.3 except comments, attachments and thumbnails (Task 10): `GET/POST /projects/{projectId}/findings`, `GET /findings/summary`, `POST /findings/bulk`, `POST /findings/recount`, `GET/PATCH/DELETE /findings/{findingId}`, `GET /projects/{projectId}/activity`; `schemas.FindingOut.from_row(row)`, `schemas.anchor_of(row) -> dict`, `FindingDetail`; job type `findings_recount`; `jobs.check_on_open(handle, runner) -> Job | None`; BK's search now returns findings.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_api.py`:
```python
"""The findings endpoints (spec 2026-09-26-foundation sections 8.3, 15)."""

import pytest
from findings_helpers import insert_cloud
from sqlalchemy import update

from app.db.models import FindingCount
from app.findings import events, jobs

API = "/api/v1"


class _Bus:
    def __init__(self):
        self.seen: list[dict] = []

    def publish(self, event: dict) -> None:
        self.seen.append(event)


@pytest.fixture
def base(project) -> str:
    return f"{API}/projects/{project['id']}"


@pytest.fixture
def cloud(handle) -> str:
    return insert_cloud(handle)


def _anchor(cloud_id: str) -> dict:
    return {"kind": "cloud", "cloud_id": cloud_id, "x": 1.0, "y": 2.0, "z": 3.0}


def _create(client, base: str, type_id: str, cloud_id: str, **body) -> dict:
    r = client.post(f"{base}/findings", json={"type_id": type_id, "anchor": _anchor(cloud_id), **body})
    assert r.status_code == 201, r.text
    return r.json()


def _error(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def test_create_get_patch_delete(client, base, crack, cloud):
    f = _create(client, base, crack["id"], cloud, severity=3, note="at pier 3")
    assert (f["number"], f["type_id"], f["severity"], f["status"], f["note"], f["created_by"]) == (
        1,
        crack["id"],
        3,
        "open",
        "at pier 3",
        "human",
    )
    assert f["anchor"] == {"kind": "cloud", "cloud_id": cloud, "x": 1.0, "y": 2.0, "z": 3.0, "uncertainty_m": None}
    assert (f["attachment_count"], f["comment_count"], f["data_type"], f["data_id"]) == (0, 0, "point_cloud", cloud)
    assert client.get(f"{base}/findings/{f['id']}").json() == f
    r = client.patch(f"{base}/findings/{f['id']}", json={"status": "reviewed"})
    assert (r.status_code, r.json()["status"]) == (200, "reviewed")
    assert client.patch(f"{base}/findings/{f['id']}", json={"status": "closed"}).status_code == 200
    assert _error(client.patch(f"{base}/findings/{f['id']}", json={"status": "reviewed"})) == (409, "invalid_transition")
    assert client.delete(f"{base}/findings/{f['id']}").status_code == 204
    assert client.get(f"{base}/findings/{f['id']}").status_code == 404


def test_an_absent_severity_takes_the_default_and_null_means_none(client, base, crack, cloud):
    assert _create(client, base, crack["id"], cloud)["severity"] == 2
    assert _create(client, base, crack["id"], cloud, severity=None)["severity"] is None


def test_an_object_type_is_not_a_defect(client, base, project, cloud):
    r = client.post(f"{base}/findings", json={"type_id": project["classes"][0]["id"], "anchor": _anchor(cloud)})
    assert _error(r) == (422, "not_a_defect")


def test_list_filters_and_pages(client, base, crack, cloud):
    for sev in [None, 1, 2, 2, 4]:
        _create(client, base, crack["id"], cloud, severity=sev)
    page = client.get(f"{base}/findings", params={"limit": 2}).json()
    assert [i["number"] for i in page["items"]] == [5, 4]
    rest = client.get(f"{base}/findings", params={"limit": 10, "cursor": page["next_cursor"]}).json()
    assert [i["number"] for i in rest["items"]] == [3, 2, 1] and rest["next_cursor"] is None
    picked = client.get(f"{base}/findings", params=[("severity", "none"), ("severity", "2"), ("sort", "number")]).json()
    assert [i["number"] for i in picked["items"]] == [1, 3, 4]
    assert _error(client.get(f"{base}/findings", params={"severity": "7"})) == (422, "validation_error")


def test_bulk(client, base, crack, cloud):
    a = _create(client, base, crack["id"], cloud)
    b = _create(client, base, crack["id"], cloud)
    r = client.post(f"{base}/findings/bulk", json={"ids": [a["id"], b["id"], "nope"], "set": {"status": "closed"}})
    assert r.status_code == 200, r.text
    assert r.json() == {"updated": 2, "skipped": [{"id": "nope", "code": "not_found"}]}


def test_summary(client, base, crack, cloud):
    _create(client, base, crack["id"], cloud, severity=4)
    _create(client, base, crack["id"], cloud, severity=None)
    out = client.get(f"{base}/findings/summary").json()
    assert out["by_status"] == {"open": 2, "reviewed": 0, "closed": 0}
    assert out["open_by_severity"]["4"] == 1
    assert out["open_no_severity"] == 1
    assert len(out["trend"]) == 60


def test_the_activity_feed(client, base, crack, cloud):
    f = _create(client, base, crack["id"], cloud)
    client.patch(f"{base}/findings/{f['id']}", json={"severity": 4})
    items = client.get(f"{base}/activity", params={"subject_id": f["id"]}).json()["items"]
    assert sorted(i["kind"] for i in items) == ["finding.created", "finding.severity"]


def test_the_recount_job_repairs_tampered_counts(client, base, project, handle, crack, cloud, wait_job):
    _create(client, base, crack["id"], cloud)
    with handle.session() as s:
        s.execute(update(FindingCount).values(n=99))
    r = client.post(f"{base}/findings/recount")
    assert r.status_code == 202, r.text
    assert wait_job(project["id"], r.json()["job"]["id"])["state"] == "succeeded"
    assert client.get(f"{base}/findings/summary").json()["by_status"]["open"] == 1


def test_the_counts_check_on_open_queues_a_recount_only_when_needed(client, project, handle, crack, cloud, wait_job):
    base = f"{API}/projects/{project['id']}"
    _create(client, base, crack["id"], cloud)
    assert jobs.check_on_open(handle, client.app.state.jobs) is None
    with handle.session() as s:
        s.execute(update(FindingCount).values(n=5))
    job = jobs.check_on_open(handle, client.app.state.jobs)
    assert wait_job(project["id"], job.id)["state"] == "succeeded"
    assert jobs.check_on_open(handle, client.app.state.jobs) is None


def test_writes_publish_findings_changed(client, base, project, crack, cloud, monkeypatch):
    bus = _Bus()
    monkeypatch.setattr(events, "_bus", bus)
    f = _create(client, base, crack["id"], cloud)
    assert [(e["type"], e["project_id"], e["payload"]) for e in bus.seen] == [
        ("findings.changed", project["id"], {"ids": [f["id"]]})
    ]


def test_search_returns_findings(client, base, crack, cloud):
    _create(client, base, crack["id"], cloud, note="spalling at pier 3")
    out = client.get(f"{base}/search", params={"q": "pier"}).json()
    assert [f["number"] for f in out["findings"]] == [1]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_api.py -v`
Expected: collection error `ImportError: cannot import name 'jobs' from 'app.findings'`.

- [ ] **Step 3: Schemas**

`backend/app/findings/schemas.py` (names from the Task 1 table; C0's contract wins):
```python
"""Pydantic shapes of the finding schemas in contract/openapi.yaml."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.db.models import Activity, Finding

Status = Literal["open", "reviewed", "closed"]
AnchorKind = Literal["image", "map", "cloud"]


class BoxGeometry(BaseModel):
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    angle: float = 0.0


class Geometry(BaseModel):
    type: Literal["Point", "Polygon"]
    coordinates: list[Any]


class ImageAnchorIn(BaseModel):
    kind: Literal["image"]
    image_id: str
    annotation_id: str | None = None
    box: BoxGeometry | None = None

    @model_validator(mode="after")
    def _one_source(self):
        if (self.annotation_id is None) == (self.box is None):
            raise ValueError("an image anchor carries annotation_id or box: exactly one of them")
        return self


class MapAnchorIn(BaseModel):
    kind: Literal["map"]
    map_id: str
    geometry: Geometry


class CloudAnchorIn(BaseModel):
    kind: Literal["cloud"]
    cloud_id: str
    x: float
    y: float
    z: float
    uncertainty_m: float | None = Field(None, ge=0)


FindingAnchorIn = Annotated[ImageAnchorIn | MapAnchorIn | CloudAnchorIn, Field(discriminator="kind")]


class FindingCreate(BaseModel):
    type_id: str
    anchor: FindingAnchorIn
    severity: int | None = Field(None, ge=1, le=9)  # absent: the type's default; null: no severity
    note: str = Field("", max_length=20000)
    status: Status = "open"


class FindingAnchorPatch(BaseModel):
    geometry: Geometry = Field(default=None)
    x: float = Field(default=None)
    y: float = Field(default=None)
    z: float = Field(default=None)
    uncertainty_m: float | None = Field(None, ge=0)


class FindingPatch(BaseModel):
    type_id: str = Field(default=None)
    severity: int | None = Field(None, ge=1, le=9)
    status: Status = Field(default=None)
    note: str = Field(default=None, max_length=20000)
    anchor: FindingAnchorPatch = Field(default=None)


class FindingBulkSet(BaseModel):
    status: Status = Field(default=None)
    severity: int | None = Field(None, ge=1, le=9)
    type_id: str = Field(default=None)


class FindingBulk(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    set: FindingBulkSet


class FindingBulkSkip(BaseModel):
    id: str
    code: str


class FindingBulkResult(BaseModel):
    updated: int
    skipped: list[FindingBulkSkip]


def anchor_of(r: Finding) -> dict[str, Any]:
    if r.anchor_kind == "image":
        return {"kind": "image", "image_id": r.image_id, "annotation_id": r.annotation_id}
    if r.anchor_kind == "map":
        return {"kind": "map", "map_id": r.map_id, "geometry": r.geometry}
    return {"kind": "cloud", "cloud_id": r.cloud_id, "x": r.x, "y": r.y, "z": r.z, "uncertainty_m": r.uncertainty_m}


class FindingOut(BaseModel):
    id: str
    number: int
    type_id: str
    severity: int | None
    status: Status
    note: str
    created_by: str
    confidence: float | None
    anchor: dict[str, Any]
    lon: float | None
    lat: float | None
    data_type: str
    data_id: str
    created_at: datetime
    updated_at: datetime
    reviewed_at: datetime | None
    closed_at: datetime | None

    @classmethod
    def from_row(cls, r: Finding) -> "FindingOut":
        return cls(
            id=r.id,
            number=r.number,
            type_id=r.type_id,
            severity=r.severity,
            status=r.status,
            note=r.note,
            created_by=r.created_by,
            confidence=r.confidence,
            anchor=anchor_of(r),
            lon=r.lon,
            lat=r.lat,
            data_type=r.data_type,
            data_id=r.data_id,
            created_at=r.created_at,
            updated_at=r.updated_at,
            reviewed_at=r.reviewed_at,
            closed_at=r.closed_at,
        )


class FindingDetail(FindingOut):
    attachment_count: int
    comment_count: int


class FindingPage(BaseModel):
    items: list[FindingOut]
    next_cursor: str | None = None


class TypeCount(BaseModel):
    type_id: str
    n: int


class TrendDay(BaseModel):
    day: date
    open: int
    closed: int
    open_by_severity: dict[str, int]  # {"<level>": n}


class StatusCounts(BaseModel):
    open: int
    reviewed: int
    closed: int


class FindingSummary(BaseModel):
    by_status: StatusCounts
    open_by_severity: dict[str, int]  # {"<level>": n}, every level of the scale
    open_no_severity: int
    by_type: list[TypeCount]
    trend: list[TrendDay]


class ActivityOut(BaseModel):
    id: str
    at: datetime
    kind: str
    subject_id: str | None
    summary: str
    payload: dict[str, Any]

    @classmethod
    def from_row(cls, a: Activity) -> "ActivityOut":
        return cls(id=a.id, at=a.at, kind=a.kind, subject_id=a.subject_id, summary=a.summary, payload=a.payload or {})


class ActivityPage(BaseModel):
    items: list[ActivityOut]
    next_cursor: str | None = None
```

- [ ] **Step 4: The recount job and the open check**

`backend/app/findings/jobs.py`:
```python
"""`findings_recount` (spec 2026-09-26-foundation section 8.3), the repair tool, and the check on
project open (section 6.1) that queues it when the stored counts disagree with the findings."""

import logging

from sqlalchemy import func, select

from app.db.models import Finding, FindingCount
from app.findings import counts
from app.jobs.registry import register_job_type

RECOUNT_JOB = "findings_recount"
log = logging.getLogger(__name__)


@register_job_type(RECOUNT_JOB)
def run_recount(ctx) -> dict:
    ctx.progress(0, "Recounting findings")
    with ctx.project.session() as s:
        result = counts.recount(s)
    ctx.publish("findings.changed", {"all": True})
    ctx.progress(1, f"Counted {result['findings']} findings")
    return result


def check_on_open(handle, runner):
    """Two reads once per project open: the stored total and the table's row count (an index
    count). When they differ, queue a recount; returns the job or None."""
    with handle.session() as s:
        stored = s.execute(select(func.coalesce(func.sum(FindingCount.n), 0))).scalar_one()
        actual = s.execute(select(func.count()).select_from(Finding)).scalar_one()
    if stored == actual:
        return None
    log.warning("project %s: finding counts say %s, the table holds %s; recounting", handle.id, stored, actual)
    return runner.submit(handle, RECOUNT_JOB, {})
```

`backend/app/main.py`, `project_opened`: add after the `("orphan job sweep", ...)` entry:
```python
        ("findings counts check", lambda: importlib.import_module("app.findings.jobs").check_on_open(handle, runner)),
```

- [ ] **Step 5: The router**

`backend/app/findings/router.py`:
```python
"""The findings endpoints (spec 2026-09-26-foundation section 8.3). Comments, attachments and
thumbnails join in plan BC Task 10."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response

from app.catalogue import service as catalogue_service
from app.data_items import search
from app.errors import AppError
from app.findings import activity, query, service
from app.findings.anchors import AnchorIn
from app.findings.jobs import RECOUNT_JOB
from app.findings.schemas import (
    ActivityOut,
    ActivityPage,
    FindingBulk,
    FindingBulkResult,
    FindingCreate,
    FindingDetail,
    FindingOut,
    FindingPage,
    FindingPatch,
    FindingSummary,
)
from app.jobs.schemas import JobOut
from app.projects.service import ProjectHandle, get_project
from app.training.schemas import JobRef

router = APIRouter(prefix="/projects/{projectId}", tags=["findings"])
SEVERITY_VALUES = {str(n) for n in range(1, 10)} | {"none"}

# BK's search (spec section 10.3) gets its findings group from here (plan BK hand-off).
search.register_finding_search(
    lambda s, q, limit: [FindingOut.from_row(r).model_dump(mode="json") for r in query.search_findings(s, q, limit)]
)


def _detail(handle: ProjectHandle, finding_id: str) -> FindingDetail:
    row, n_att, n_com = service.get_finding(handle, finding_id)
    return FindingDetail(**FindingOut.from_row(row).model_dump(), attachment_count=n_att, comment_count=n_com)


@router.get("/findings", response_model=FindingPage)
def list_findings(
    handle: ProjectHandle = Depends(get_project),
    status: list[Literal["open", "reviewed", "closed"]] | None = Query(None),
    severity: list[str] | None = Query(None),
    type_id: list[str] | None = Query(None),
    anchor_kind: list[Literal["image", "map", "cloud"]] | None = Query(None),
    data_id: str | None = None,
    image_id: str | None = None,
    created_by: Literal["human", "model"] | None = None,
    q: str | None = Query(None, max_length=200),
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    has_location: bool | None = None,
    sort: Literal["-severity", "number", "-updated_at", "type"] = "-severity",
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> FindingPage:
    if severity and not set(severity) <= SEVERITY_VALUES:
        raise AppError("validation_error", "severity takes 1-9 or none", 422)
    filters = query.FindingFilters(
        status=status,
        severity=severity,
        type_id=type_id,
        anchor_kind=anchor_kind,
        data_id=data_id,
        image_id=image_id,
        created_by=created_by,
        q=q,
        updated_from=updated_from,
        updated_to=updated_to,
        has_location=has_location,
    )
    with handle.session() as s:
        rows, nxt = query.list_findings(s, filters, sort=sort, cursor=cursor, limit=limit)
        items = [FindingOut.from_row(r) for r in rows]
    return FindingPage(items=items, next_cursor=nxt)


@router.post("/findings", response_model=FindingDetail, status_code=201)
def create_finding(body: FindingCreate, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:
    kw = {
        "type_id": body.type_id,
        "anchor": AnchorIn(**body.anchor.model_dump()),
        "note": body.note,
        "status": body.status,
    }
    if "severity" in body.model_fields_set:
        kw["severity"] = body.severity
    row = service.create_finding(handle, **kw)
    return FindingDetail(**FindingOut.from_row(row).model_dump(), attachment_count=0, comment_count=0)


@router.get("/findings/summary", response_model=FindingSummary)
def findings_summary(handle: ProjectHandle = Depends(get_project)) -> FindingSummary:
    levels = catalogue_service.scale_levels(handle.catalogue)
    with handle.session() as s:
        return FindingSummary(**query.summary(s, levels=levels))


@router.post("/findings/bulk", response_model=FindingBulkResult)
def bulk_update_findings(body: FindingBulk, handle: ProjectHandle = Depends(get_project)) -> FindingBulkResult:
    with handle.session() as s:
        result = query.bulk(
            s,
            project_id=handle.id,
            catalogue=handle.catalogue,
            ids=body.ids,
            set_fields=body.set.model_dump(exclude_unset=True),
        )
    return FindingBulkResult(**result)


@router.post("/findings/recount", response_model=JobRef, status_code=202)
def recount_findings(request: Request, handle: ProjectHandle = Depends(get_project)) -> JobRef:
    job = request.app.state.jobs.submit(handle, RECOUNT_JOB, {})
    return JobRef(job=JobOut.from_row(job, handle.id))


@router.get("/findings/{findingId}", response_model=FindingDetail)
def get_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FindingDetail:  # noqa: N803
    return _detail(handle, findingId)


@router.patch("/findings/{findingId}", response_model=FindingDetail)
def patch_finding(
    findingId: str,  # noqa: N803
    body: FindingPatch,
    handle: ProjectHandle = Depends(get_project),
) -> FindingDetail:
    fields = body.model_dump(exclude_unset=True)
    if "anchor" in fields:
        fields["anchor"] = body.anchor.model_dump(exclude_unset=True)
    service.patch_finding(handle, findingId, fields)
    return _detail(handle, findingId)


@router.delete("/findings/{findingId}", status_code=204)
def delete_finding(findingId: str, handle: ProjectHandle = Depends(get_project)) -> Response:  # noqa: N803
    service.delete_finding(handle, findingId)
    return Response(status_code=204)


@router.get("/activity", response_model=ActivityPage)
def list_activity(
    handle: ProjectHandle = Depends(get_project),
    subject_id: str | None = None,
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> ActivityPage:
    with handle.session() as s:
        rows, nxt = activity.page(s, subject_id=subject_id, cursor=cursor, limit=limit)
        items = [ActivityOut.from_row(a) for a in rows]
    return ActivityPage(items=items, next_cursor=nxt)
```

In `backend/app/api.py`: `from app.findings.router import router as findings_router` in sorted
position, `findings_router,` in the plain tuple. Delete C0's stubs and `EXPECTED_STUBS` entries for
these nine operations if Task 1 found any.

In `backend/tests/test_contract.py`, add to `REFUSES_VALID_DATA` (with the real operationIds):
```python
    # BC: generated type ids are unknown (`unknown_type`), a level above the scale
    # (`severity_unknown`), a generated geometry that is not a closed ring (`invalid_geometry`),
    # a patch of an image anchor (`anchor_immutable`).
    "createFinding": {422},
    "patchFinding": {422},
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_api.py tests/test_contract.py tests/test_search.py -q -p no:cacheprovider`
Expected: the findings API tests and BK's search tests pass; `test_contract.py` fails only on
the operations of Tasks 10 and 13 (comments, attachments, thumbnails, overview).

- [ ] **Step 7: Lint and commit**

```powershell
& $PY -m ruff format app/findings app/api.py app/main.py tests/test_findings_api.py tests/test_contract.py
& $PY -m ruff check app/findings app/api.py app/main.py tests/test_findings_api.py tests/test_contract.py
cd ..
git add backend/app/findings/schemas.py backend/app/findings/jobs.py backend/app/findings/router.py backend/app/api.py backend/app/main.py backend/tests/test_findings_api.py backend/tests/test_contract.py
git commit -m @'
feat(findings): findings API, activity feed, recount job, counts check on open, search

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 10: Comments, attachments, thumbnails and the trash purge

**Files:**
- Create: `backend/app/findings/comments.py`, `backend/app/findings/attachments.py`, `backend/app/findings/thumbnails.py`, `backend/app/findings/operator_router.py` (`GET/PUT /settings/operator`, C0's `getOperatorSettings`/`putOperatorSettings`)
- Modify: `backend/app/findings/schemas.py` (comment and attachment shapes), `backend/app/findings/router.py` (the routes), `backend/app/api.py` (include `operator_router` plainly), `backend/app/main.py` (`project_opened` step "finding trash purge"), `backend/tests/test_contract.py`
- Test: `backend/tests/test_findings_files.py`

**Interfaces:**
- Consumes: Task 7 `trash.move_file`, `trash.purge`, `service.get_finding`; Task 6 `activity.record`, `events.mark_changed`, `numbers.format_number`; `app.appdata.AppData`; `app.datasets.images.image_file(handle, image_id, None) -> Path`; `app.geometry.aabb_of`; Pillow.
- Produces:
  - `comments.page(s, finding_id, *, cursor=None, limit=None)`, `comments.add(s, *, project_id, finding_id, text, author)`, `comments.edit(s, *, project_id, finding_id, comment_id, text)`, `comments.delete(s, *, project_id, finding_id, comment_id)`, `comments.author_name(data_dir) -> str`, `comments.operator_name(data_dir) -> str | None`, `comments.set_operator_name(data_dir, name: str | None) -> str | None`, `comments.MAX_TEXT = 4000`
  - routes `GET /settings/operator` and `PUT /settings/operator` (`OperatorSettings {operator_name: string | null}`): S2's Settings "Your name" writes through them (the index's operator decision 3), and `author_name` reads the same `settings.json` key
  - `attachments.add(handle, finding_id, source: str) -> FindingAttachment`, `attachments.list_for(handle, finding_id)`, `attachments.delete(handle, finding_id, attachment_id)`, `attachments.file(handle, finding_id, attachment_id) -> tuple[Path, str]`, `attachments.thumbnail(handle, finding_id, attachment_id) -> Path`, `attachments.MAX_BYTES`, `attachments.FORMATS`
  - `thumbnails.finding_thumbnail(handle, finding_id) -> Path`, `thumbnails.crop_window(x, y, w, h, angle, img_w, img_h) -> tuple[int, int, int, int]`, `thumbnails.SIZE = (160, 120)`
  - routes `GET/POST /findings/{findingId}/comments`, `PATCH/DELETE /findings/{findingId}/comments/{commentId}`, `GET/POST /findings/{findingId}/attachments`, `DELETE /findings/{findingId}/attachments/{attachmentId}`, `GET …/{attachmentId}/file`, `GET …/{attachmentId}/thumbnail`, `GET /findings/{findingId}/thumbnail`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_files.py`:
```python
"""Comments, attachments and thumbnails (spec 2026-09-26-foundation sections 8.3, 14, 15)."""

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from findings_helpers import insert_cloud
from PIL import Image as PILImage

from app.appdata import AppData
from app.findings import attachments, trash
from app.main import project_opened

API = "/api/v1"


@pytest.fixture
def ctx(client, project, crack, handle) -> dict:
    cloud = insert_cloud(handle)
    base = f"{API}/projects/{project['id']}"
    body = {"type_id": crack["id"], "anchor": {"kind": "cloud", "cloud_id": cloud, "x": 0.0, "y": 0.0, "z": 0.0}}
    f = client.post(f"{base}/findings", json=body).json()
    return {"base": base, "fid": f["id"], "url": f"{base}/findings/{f['id']}"}


def _error(r) -> tuple[int, str]:
    return r.status_code, r.json()["error"]["code"]


def test_comments_thread_oldest_first_with_the_settings_name(client, settings, ctx):
    assert client.post(f"{ctx['url']}/comments", json={"text": "first"}).json()["author"] == "Operator"
    AppData(settings.data_dir).write_settings({"operator_name": "Dana"})
    second = client.post(f"{ctx['url']}/comments", json={"text": "second"}).json()
    assert second["author"] == "Dana" and second["edited_at"] is None
    page = client.get(f"{ctx['url']}/comments", params={"limit": 1}).json()
    assert [c["text"] for c in page["items"]] == ["first"]
    rest = client.get(f"{ctx['url']}/comments", params={"cursor": page["next_cursor"]}).json()
    assert [c["text"] for c in rest["items"]] == ["second"]
    edited = client.patch(f"{ctx['url']}/comments/{second['id']}", json={"text": "second, edited"}).json()
    assert edited["text"] == "second, edited" and edited["edited_at"] is not None
    assert client.get(ctx["url"]).json()["comment_count"] == 2
    assert client.delete(f"{ctx['url']}/comments/{second['id']}").status_code == 204
    assert client.get(ctx["url"]).json()["comment_count"] == 1
    kinds = [a["kind"] for a in client.get(f"{ctx['base']}/activity", params={"subject_id": ctx["fid"]}).json()["items"]]
    assert kinds.count("finding.comment") == 2


def test_the_operator_name_is_read_and_written_through_the_settings_api(client, settings, ctx):
    AppData(settings.data_dir).write_settings({"providers": {"openai": {"model": "x"}}})
    assert client.get(f"{API}/settings/operator").json() == {"operator_name": None}
    assert client.put(f"{API}/settings/operator", json={"operator_name": "  Dana  "}).json() == {"operator_name": "Dana"}
    assert client.post(f"{ctx['url']}/comments", json={"text": "hi"}).json()["author"] == "Dana"
    stored = AppData(settings.data_dir).read_settings()
    assert stored["operator_name"] == "Dana" and stored["providers"] == {"openai": {"model": "x"}}
    assert client.put(f"{API}/settings/operator", json={"operator_name": "   "}).json() == {"operator_name": None}
    assert "operator_name" not in AppData(settings.data_dir).read_settings()
    assert client.post(f"{ctx['url']}/comments", json={"text": "again"}).json()["author"] == "Operator"


def test_a_blank_or_long_comment_is_refused(client, ctx):
    assert _error(client.post(f"{ctx['url']}/comments", json={"text": "   "})) == (409, "comment_blank")
    assert client.post(f"{ctx['url']}/comments", json={"text": "x" * 4001}).status_code == 422


def test_an_attachment_is_checked_copied_and_thumbnailed(client, handle, ctx, tmp_path, make_jpeg):
    src = make_jpeg(tmp_path / "site photo.jpg", 640, 480, seed=3)
    r = client.post(f"{ctx['url']}/attachments", json={"path": str(src)})
    assert r.status_code == 201, r.text
    a = r.json()
    assert (a["original_name"], a["width"], a["height"], a["bytes"]) == ("site photo.jpg", 640, 480, src.stat().st_size)
    copied = handle.folder / "findings" / ctx["fid"] / f"{a['id']}.jpg"
    assert copied.read_bytes() == src.read_bytes()
    assert client.get(f"{ctx['url']}/attachments/{a['id']}/file").content == src.read_bytes()
    thumb = PILImage.open(BytesIO(client.get(f"{ctx['url']}/attachments/{a['id']}/thumbnail").content))
    assert max(thumb.size) == 256
    assert [i["id"] for i in client.get(f"{ctx['url']}/attachments").json()["items"]] == [a["id"]]
    assert client.get(ctx["url"]).json()["attachment_count"] == 1
    assert client.delete(f"{ctx['url']}/attachments/{a['id']}").status_code == 204
    assert not copied.exists()
    assert list((handle.folder / "findings" / "_trash").glob(f"{ctx['fid']}-*/{a['id']}.jpg"))


@pytest.mark.parametrize("kind", ["missing", "relative", "text", "gif", "too_large"])
def test_a_bad_attachment_is_attachment_invalid(client, ctx, tmp_path, make_jpeg, monkeypatch, kind):
    path = tmp_path / "x.jpg"
    reason = {"missing": "not_found", "relative": "not_absolute", "text": "not_an_image", "gif": "not_an_image", "too_large": "too_large"}[kind]
    if kind == "relative":
        path = "photos/x.jpg"
    elif kind == "text":
        path.write_text("not a photo")
    elif kind == "gif":
        path = tmp_path / "x.gif"
        PILImage.new("RGB", (8, 8)).save(path, "GIF")
    elif kind == "too_large":
        make_jpeg(path, 64, 48)
        monkeypatch.setattr(attachments, "MAX_BYTES", 10)
    r = client.post(f"{ctx['url']}/attachments", json={"path": str(path)})
    assert _error(r) == (422, "attachment_invalid")
    assert r.json()["error"]["details"]["reason"] == reason


def test_the_finding_thumbnail_falls_back_to_the_first_attachment(client, ctx, tmp_path, make_jpeg):
    assert client.get(f"{ctx['url']}/thumbnail").status_code == 404
    client.post(f"{ctx['url']}/attachments", json={"path": str(make_jpeg(tmp_path / "p.jpg", 300, 200))})
    r = client.get(f"{ctx['url']}/thumbnail")
    assert (r.status_code, r.headers["content-type"]) == (200, "image/jpeg")


def test_the_trash_is_purged_when_the_project_opens(client, handle):
    old = (datetime.now(UTC) - timedelta(days=31)).strftime(trash.STAMP)
    entry = handle.folder / "findings" / "_trash" / f"f1-{old}"
    entry.mkdir(parents=True)
    project_opened(handle, client.app.state.jobs)
    assert not entry.exists()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_files.py -v`
Expected: FAIL, the comment and attachment routes answer `404` (or C0's `501`).

- [ ] **Step 3: Comments**

`backend/app/findings/comments.py`:
```python
"""A finding's comment thread (spec 2026-09-26-foundation section 8.3): oldest first, paged. The
author is the Settings "Your name" (`operator_name` in settings.json), else "Operator"."""

from datetime import datetime
from pathlib import Path

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.appdata import AppData
from app.db.base import utcnow
from app.db.models import Finding, FindingComment
from app.errors import AppError, not_found
from app.findings import activity, events, numbers
from app.pagination import clamp_limit, decode_cursor, encode_cursor

MAX_TEXT = 4000
DEFAULT_AUTHOR = "Operator"
EXCERPT = 60


def author_name(data_dir: Path) -> str:
    try:
        name = AppData(data_dir).read_settings().get("operator_name")
    except Exception:  # an unreadable settings file never blocks a comment
        return DEFAULT_AUTHOR
    return name.strip()[:80] if isinstance(name, str) and name.strip() else DEFAULT_AUTHOR


def operator_name(data_dir: Path) -> str | None:
    """The stored name, or None when unset or unreadable (GET /settings/operator)."""
    try:
        name = AppData(data_dir).read_settings().get("operator_name")
    except Exception:
        return None
    return name.strip()[:80] if isinstance(name, str) and name.strip() else None


def set_operator_name(data_dir: Path, name: str | None) -> str | None:
    """PUT /settings/operator: trims, caps at 80, clears on blank; keeps every other settings key."""
    app_data = AppData(data_dir)
    try:
        values = app_data.read_settings()
    except Exception:  # an unreadable file is replaced rather than blocking the name
        values = {}
    clean = (name or "").strip()[:80]
    if clean:
        values["operator_name"] = clean
    else:
        values.pop("operator_name", None)
    app_data.write_settings(values)
    return clean or None


def _text(text: str) -> str:
    clean = (text or "").strip()
    if not clean:
        raise AppError("comment_blank", "A comment cannot be blank.", 409)
    if len(clean) > MAX_TEXT:
        raise AppError("validation_error", f"a comment holds at most {MAX_TEXT} characters", 422)
    return clean


def _finding(s: Session, finding_id: str) -> Finding:
    f = s.get(Finding, finding_id)
    if f is None:
        raise not_found("finding", finding_id)
    return f


def _comment(s: Session, finding_id: str, comment_id: str) -> FindingComment:
    row = s.get(FindingComment, comment_id)
    if row is None or row.finding_id != finding_id:
        raise not_found("comment", comment_id)
    return row


def page(
    s: Session, finding_id: str, *, cursor: str | None = None, limit: int | None = None
) -> tuple[list[FindingComment], str | None]:
    _finding(s, finding_id)
    n = clamp_limit(limit)
    q = select(FindingComment).where(FindingComment.finding_id == finding_id)
    c = decode_cursor(cursor, "at", "id")
    if c:
        at = datetime.fromisoformat(c["at"])
        q = q.where(
            or_(FindingComment.created_at > at, and_(FindingComment.created_at == at, FindingComment.id > c["id"]))
        )
    rows = s.execute(q.order_by(FindingComment.created_at, FindingComment.id).limit(n + 1)).scalars().all()
    nxt = encode_cursor(at=rows[n - 1].created_at.isoformat(), id=rows[n - 1].id) if len(rows) > n else None
    return list(rows[:n]), nxt


def add(s: Session, *, project_id: str, finding_id: str, text: str, author: str) -> FindingComment:
    f = _finding(s, finding_id)
    row = FindingComment(finding_id=f.id, author=author, text=_text(text))
    s.add(row)
    s.flush()
    excerpt = row.text if len(row.text) <= EXCERPT else row.text[: EXCERPT - 1] + "…"
    activity.record(
        s, "finding.comment", f.id, f"Comment on {numbers.format_number(f.number)}: {excerpt}", {"comment_id": row.id}
    )
    f.updated_at = utcnow()
    events.mark_changed(s, project_id, [f.id])
    return row


def edit(s: Session, *, project_id: str, finding_id: str, comment_id: str, text: str) -> FindingComment:
    row = _comment(s, finding_id, comment_id)
    row.text = _text(text)
    row.edited_at = utcnow()
    events.mark_changed(s, project_id, [finding_id])
    return row


def delete(s: Session, *, project_id: str, finding_id: str, comment_id: str) -> None:
    s.delete(_comment(s, finding_id, comment_id))
    events.mark_changed(s, project_id, [finding_id])
```

- [ ] **Step 4: Attachments and thumbnails**

`backend/app/findings/attachments.py`:
```python
"""Finding photos (spec 2026-09-26-foundation sections 8.3, 14): a local file chosen in the Tauri
dialog, JPEG, PNG or WebP, at most 50 MB, checked with Pillow before a byte is copied, then copied
into `findings/<finding_id>/` with a 256 px thumbnail. The copy is synchronous: the one sanctioned
exception to "long work is a job", since a photo copy is well under a second."""

import shutil
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageOps, UnidentifiedImageError
from sqlalchemy import select

from app.db.base import new_id, utcnow
from app.db.models import Finding, FindingAttachment
from app.errors import AppError, not_found
from app.findings import events, trash

MAX_BYTES = 50 * 1024 * 1024
FORMATS = {"JPEG": (".jpg", "image/jpeg"), "PNG": (".png", "image/png"), "WEBP": (".webp", "image/webp")}
MEDIA = {ext: media for ext, media in FORMATS.values()}
THUMB = 256


def _invalid(reason: str, message: str, **details) -> AppError:
    return AppError("attachment_invalid", message, 422, {"reason": reason, **details})


def inspect(path: Path) -> tuple[str, int, int, int]:
    """(format, width, height, bytes), or 422 `attachment_invalid` with the reason."""
    if not path.is_absolute():
        raise _invalid("not_absolute", f"{path} is not an absolute path.")
    if not path.is_file():
        raise _invalid("not_found", f"{path} is not a file.")
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise _invalid("too_large", f"{path.name} is {size / 1024 / 1024:.0f} MB; the limit is 50 MB.", bytes=size)
    try:
        with PILImage.open(path) as im:
            fmt, (width, height) = im.format, im.size
            im.verify()
    except (PILImage.DecompressionBombError, UnidentifiedImageError, OSError, SyntaxError, ValueError) as e:
        raise _invalid("not_an_image", f"{path.name} is not a JPEG, PNG or WebP photo.") from e
    if fmt not in FORMATS:
        raise _invalid("not_an_image", f"{path.name} is a {fmt} image; use JPEG, PNG or WebP.")
    return fmt, width, height, size


def thumb_path(handle, attachment_id: str) -> Path:
    return handle.thumbs_dir / "findings" / "attachments" / f"{attachment_id}.jpg"


def _write_thumb(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with PILImage.open(src) as im:
        im = ImageOps.exif_transpose(im)
        im.thumbnail((THUMB, THUMB))
        im.convert("RGB").save(dest, "JPEG", quality=85)
    return dest


def _require_finding(s, finding_id: str) -> Finding:
    f = s.get(Finding, finding_id)
    if f is None:
        raise not_found("finding", finding_id)
    return f


def add(handle, finding_id: str, source: str) -> FindingAttachment:
    with handle.session() as s:
        _require_finding(s, finding_id)
    src = Path(source)
    fmt, width, height, size = inspect(src)
    aid = new_id()
    rel = f"findings/{finding_id}/{aid}{FORMATS[fmt][0]}"
    dest = handle.folder / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    try:
        _write_thumb(dest, thumb_path(handle, aid))
        with handle.session() as s:
            f = _require_finding(s, finding_id)  # deleted while the file copied: undo the copy
            row = FindingAttachment(
                id=aid, finding_id=finding_id, path=rel, original_name=src.name[:255], width=width, height=height, bytes=size
            )
            s.add(row)
            f.updated_at = utcnow()
            events.mark_changed(s, handle.id, [finding_id])
            s.flush()
            s.expunge(row)
    except Exception:
        dest.unlink(missing_ok=True)
        thumb_path(handle, aid).unlink(missing_ok=True)
        raise
    return row


def list_for(handle, finding_id: str) -> list[FindingAttachment]:
    with handle.session() as s:
        _require_finding(s, finding_id)
        rows = list(
            s.execute(
                select(FindingAttachment)
                .where(FindingAttachment.finding_id == finding_id)
                .order_by(FindingAttachment.created_at, FindingAttachment.id)
            ).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def _row(s, finding_id: str, attachment_id: str) -> FindingAttachment:
    row = s.get(FindingAttachment, attachment_id)
    if row is None or row.finding_id != finding_id:
        raise not_found("attachment", attachment_id)
    return row


def delete(handle, finding_id: str, attachment_id: str) -> None:
    with handle.session() as s:
        row = _row(s, finding_id, attachment_id)
        rel = row.path
        s.delete(row)
        events.mark_changed(s, handle.id, [finding_id])
    trash.move_file(handle, rel)
    thumb_path(handle, attachment_id).unlink(missing_ok=True)


def file(handle, finding_id: str, attachment_id: str) -> tuple[Path, str]:
    with handle.session() as s:
        rel = _row(s, finding_id, attachment_id).path
    path = handle.folder / rel
    if not path.is_file():
        raise not_found("attachment file", attachment_id)
    return path, MEDIA.get(path.suffix.lower(), "application/octet-stream")


def thumbnail(handle, finding_id: str, attachment_id: str) -> Path:
    dest = thumb_path(handle, attachment_id)
    if dest.is_file():
        return dest
    src, _ = file(handle, finding_id, attachment_id)
    return _write_thumb(src, dest)
```

`backend/app/findings/thumbnails.py`:
```python
"""A finding's list thumbnail (spec 2026-09-26-foundation section 8.3): for an image anchor a
160x120 crop around its annotation, cached under `cache/thumbs/findings/` and keyed by the box
geometry, so a moved box gets a new crop; otherwise the first attachment's thumbnail; otherwise 404.
One image read per crop, then the cache (spec section 14)."""

import hashlib
from pathlib import Path

from PIL import Image as PILImage
from PIL import ImageOps
from sqlalchemy import select

from app.datasets import images
from app.db.models import Box, Finding, FindingAttachment, Image
from app.errors import not_found
from app.findings import attachments
from app.geometry import aabb_of

SIZE = (160, 120)
PAD = 0.25  # of the box's longer side, on every side
LETTERBOX = (14, 15, 28)  # --bg


def crop_window(x: float, y: float, w: float, h: float, angle: float, img_w: int, img_h: int) -> tuple[int, int, int, int]:
    """A 4:3 window around the box with padding, moved (not shrunk) to stay inside the image where
    it fits, clamped where it does not."""
    ax, ay, aw, ah = aabb_of(x, y, w, h, angle)
    side = max(aw, ah) * (1 + 2 * PAD)
    win_w = max(side, ah * (1 + 2 * PAD) * 4 / 3)
    win_h = win_w * 3 / 4
    win_w, win_h = min(win_w, img_w), min(win_h, img_h)
    cx, cy = ax + aw / 2, ay + ah / 2
    left = min(max(cx - win_w / 2, 0), img_w - win_w)
    top = min(max(cy - win_h / 2, 0), img_h - win_h)
    return round(left), round(top), round(left + win_w), round(top + win_h)


def finding_thumbnail(handle, finding_id: str) -> Path:
    with handle.session() as s:
        f = s.get(Finding, finding_id)
        if f is None:
            raise not_found("finding", finding_id)
        box = s.get(Box, f.annotation_id) if f.annotation_id else None
        image = s.get(Image, f.image_id) if f.image_id else None
        first = s.execute(
            select(FindingAttachment.id)
            .where(FindingAttachment.finding_id == finding_id)
            .order_by(FindingAttachment.created_at, FindingAttachment.id)
            .limit(1)
        ).scalar_one_or_none()
        geometry = (box.x, box.y, box.w, box.h, box.angle) if box is not None else None
        size = (image.width, image.height) if image is not None else None
        image_id = image.id if image is not None else None
    if geometry is not None and size is not None:
        sig = hashlib.sha1(",".join(f"{v:.2f}" for v in geometry).encode()).hexdigest()[:12]
        dest = handle.thumbs_dir / "findings" / f"{finding_id}-{sig}.jpg"
        if not dest.is_file():
            dest.parent.mkdir(parents=True, exist_ok=True)
            src = images.image_file(handle, image_id, None)
            with PILImage.open(src) as im:
                crop = im.convert("RGB").crop(crop_window(*geometry, *size))
                ImageOps.pad(crop, SIZE, color=LETTERBOX).save(dest, "JPEG", quality=85)
        return dest
    if first is not None:
        return attachments.thumbnail(handle, finding_id, first)
    raise not_found("thumbnail", finding_id)
```

- [ ] **Step 5: Schemas and routes**

Append to `backend/app/findings/schemas.py`:
```python
class FindingCommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class FindingCommentOut(BaseModel):
    id: str
    finding_id: str
    author: str
    text: str
    created_at: datetime
    edited_at: datetime | None


class FindingCommentPage(BaseModel):
    items: list[FindingCommentOut]
    next_cursor: str | None = None


class FindingAttachmentIn(BaseModel):
    path: str = Field(min_length=1)


class FindingAttachmentOut(BaseModel):
    id: str
    finding_id: str
    path: str
    original_name: str
    width: int
    height: int
    bytes: int
    created_at: datetime


class FindingAttachmentList(BaseModel):
    items: list[FindingAttachmentOut]
```

Append to `backend/app/findings/router.py` (and extend its imports with `from fastapi.responses import FileResponse`,
`from app.findings import attachments, comments, thumbnails` and the five new schema names):
```python
def _comment_out(c) -> FindingCommentOut:
    return FindingCommentOut(
        id=c.id, finding_id=c.finding_id, author=c.author, text=c.text, created_at=c.created_at, edited_at=c.edited_at
    )


def _attachment_out(a) -> FindingAttachmentOut:
    return FindingAttachmentOut(
        id=a.id,
        finding_id=a.finding_id,
        path=a.path,
        original_name=a.original_name,
        width=a.width,
        height=a.height,
        bytes=a.bytes,
        created_at=a.created_at,
    )


@router.get("/findings/{findingId}/thumbnail", response_class=FileResponse)
def get_finding_thumbnail(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FileResponse:  # noqa: N803
    return FileResponse(thumbnails.finding_thumbnail(handle, findingId), media_type="image/jpeg")


@router.get("/findings/{findingId}/comments", response_model=FindingCommentPage)
def list_finding_comments(
    findingId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
    cursor: str | None = None,
    limit: int | None = Query(None, ge=1),
) -> FindingCommentPage:
    with handle.session() as s:
        rows, nxt = comments.page(s, findingId, cursor=cursor, limit=limit)
        items = [_comment_out(c) for c in rows]
    return FindingCommentPage(items=items, next_cursor=nxt)


@router.post("/findings/{findingId}/comments", response_model=FindingCommentOut, status_code=201)
def create_finding_comment(
    findingId: str,  # noqa: N803
    body: FindingCommentIn,
    request: Request,
    handle: ProjectHandle = Depends(get_project),
) -> FindingCommentOut:
    author = comments.author_name(request.app.state.settings.data_dir)
    with handle.session() as s:
        row = comments.add(s, project_id=handle.id, finding_id=findingId, text=body.text, author=author)
        s.flush()
        return _comment_out(row)


@router.patch("/findings/{findingId}/comments/{commentId}", response_model=FindingCommentOut)
def patch_finding_comment(
    findingId: str,  # noqa: N803
    commentId: str,  # noqa: N803
    body: FindingCommentIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingCommentOut:
    with handle.session() as s:
        row = comments.edit(s, project_id=handle.id, finding_id=findingId, comment_id=commentId, text=body.text)
        s.flush()
        return _comment_out(row)


@router.delete("/findings/{findingId}/comments/{commentId}", status_code=204)
def delete_finding_comment(
    findingId: str,  # noqa: N803
    commentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    with handle.session() as s:
        comments.delete(s, project_id=handle.id, finding_id=findingId, comment_id=commentId)
    return Response(status_code=204)


@router.get("/findings/{findingId}/attachments", response_model=FindingAttachmentList)
def list_finding_attachments(findingId: str, handle: ProjectHandle = Depends(get_project)) -> FindingAttachmentList:  # noqa: N803
    return FindingAttachmentList(items=[_attachment_out(a) for a in attachments.list_for(handle, findingId)])


@router.post("/findings/{findingId}/attachments", response_model=FindingAttachmentOut, status_code=201)
def add_finding_attachment(
    findingId: str,  # noqa: N803
    body: FindingAttachmentIn,
    handle: ProjectHandle = Depends(get_project),
) -> FindingAttachmentOut:
    return _attachment_out(attachments.add(handle, findingId, body.path))


@router.delete("/findings/{findingId}/attachments/{attachmentId}", status_code=204)
def delete_finding_attachment(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> Response:
    attachments.delete(handle, findingId, attachmentId)
    return Response(status_code=204)


@router.get("/findings/{findingId}/attachments/{attachmentId}/file", response_class=FileResponse)
def get_finding_attachment_file(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> FileResponse:
    path, media = attachments.file(handle, findingId, attachmentId)
    return FileResponse(path, media_type=media)


@router.get("/findings/{findingId}/attachments/{attachmentId}/thumbnail", response_class=FileResponse)
def get_finding_attachment_thumbnail(
    findingId: str,  # noqa: N803
    attachmentId: str,  # noqa: N803
    handle: ProjectHandle = Depends(get_project),
) -> FileResponse:
    return FileResponse(attachments.thumbnail(handle, findingId, attachmentId), media_type="image/jpeg")
```

`backend/app/main.py`, `project_opened`: add after the findings counts check:
```python
        ("finding trash purge", lambda: importlib.import_module("app.findings.trash").purge(handle)),
```

Create `backend/app/findings/operator_router.py`:
```python
"""The operator's name on comments (C0 `getOperatorSettings`/`putOperatorSettings`)."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.findings import comments

router = APIRouter()


class OperatorSettings(BaseModel):
    operator_name: str | None = Field(default=None, max_length=80)


@router.get("/settings/operator", response_model=OperatorSettings)
def get_operator_settings(request: Request) -> OperatorSettings:
    return OperatorSettings(operator_name=comments.operator_name(request.app.state.settings.data_dir))


@router.put("/settings/operator", response_model=OperatorSettings)
def put_operator_settings(body: OperatorSettings, request: Request) -> OperatorSettings:
    name = comments.set_operator_name(request.app.state.settings.data_dir, body.operator_name)
    return OperatorSettings(operator_name=name)
```
In `backend/app/api.py`: `from app.findings.operator_router import router as operator_router` in
sorted position and `operator_router,` in the plain `for r in (...)` tuple (app-level, no project).

`backend/tests/test_contract.py`: delete C0's stubs and `EXPECTED_STUBS` entries for these ten
operations and for `getOperatorSettings`/`putOperatorSettings` if any, and add `"addFindingAttachment": {422},` to `REFUSES_VALID_DATA` (a generated
path is never an image file: `attachment_invalid`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_files.py tests/test_findings_api.py tests/test_contract.py -q -p no:cacheprovider`
Expected: the files tests pass; `test_contract.py` fails only on `getProjectOverview` (Task 13).

- [ ] **Step 7: Lint and commit**

```powershell
& $PY -m ruff format app/findings app/api.py app/main.py tests/test_findings_files.py tests/test_contract.py
& $PY -m ruff check app/findings app/api.py app/main.py tests/test_findings_files.py tests/test_contract.py
cd ..
git add backend/app/findings/comments.py backend/app/findings/attachments.py backend/app/findings/thumbnails.py backend/app/findings/operator_router.py backend/app/findings/schemas.py backend/app/findings/router.py backend/app/api.py backend/app/main.py backend/tests/test_findings_files.py backend/tests/test_contract.py
git commit -m @'
feat(findings): comments, photo attachments, thumbnails and the trash purge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 11: The annotation ↔ finding invariant

**Files:**
- Create: `backend/app/findings/annotations.py`
- Modify: `backend/app/datasets/boxes.py` (full replacement below), `backend/app/datasets/images.py` (`bulk_delete`: two lines), `backend/app/datasets/router.py` (`confirm_finding_delete` on `PATCH /boxes/{boxId}`)
- Modify: `backend/app/findings/service.py` (`delete_in_session` deletes an image finding's box; `patch_in_session` moves the box with a type change; `create_finding` draws or adopts the box)
- Test: `backend/tests/test_findings_invariant.py`

**Interfaces:**
- Consumes: Task 7 `service.create_in_session`, `delete_in_session`, `patch_in_session`, `defect_type`; Task 6 `activity.record`; Task 7 `trash.move`; Task 10 `thumbnails.finding_thumbnail`.
- Produces:
  - `annotations.GROUND_TRUTH`, `annotations.created_by(box) -> str`, `annotations.finding_of(s, box_id) -> Finding | None`, `annotations.on_box_created(s, project_id, catalogue, box) -> None`, `annotations.on_box_changed(s, project_id, catalogue, box, *, confirm_finding_delete=False, accepted=None) -> list[str]`, `annotations.on_box_deleting(s, project_id, box) -> list[str]`, `annotations.on_images_deleting(s, project_id, image_ids) -> list[str]`, `annotations.record_accepted(s, finding_ids)`
  - `boxes.create_box_in_session(s, handle, image_id, class_id, x, y, w, h, angle=0.0, query_run_id=None) -> Box`, `boxes.reclass_in_session(s, box_id, class_id) -> None`, `boxes.delete_box_in_session(s, row) -> None`; `boxes.update_box(handle, box_id, *, confirm_finding_delete=False, **fields)`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_invariant.py`:
```python
"""An annotation on a defect type IS a finding's geometry (spec 2026-09-26-foundation section 8.5;
umbrella section 3). Every row of the section 8.5 table, through the real box routes."""

from io import BytesIO

import pytest
from PIL import Image as PILImage
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.db.models import Activity, Box, FindingCount

API = "/api/v1"


@pytest.fixture
def ctx(client, project, crack, import_source, tmp_path, make_jpeg) -> dict:
    """One 320x240 image with a GPS fix, the defect type `crack` and the object type `dump_truck`."""
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1, exif={"lat": 45.1, "lon": 15.2})
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    return {"base": base, "image_id": image_id, "crack": crack["id"], "truck": project["classes"][3]["id"]}


def _box(client, ctx, class_id: str, **kw) -> dict:
    body = {"class_id": class_id, "x": 10, "y": 20, "w": 30, "h": 40, **kw}
    r = client.post(f"{ctx['base']}/images/{ctx['image_id']}/boxes", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _proposal(handle, ctx, class_id: str, model_id: str = "m1") -> str:
    with handle.session() as s:
        row = Box(
            image_id=ctx["image_id"],
            class_id=class_id,
            x=5,
            y=5,
            w=20,
            h=20,
            confidence=0.7,
            provenance_kind="local_model",
            model_id=model_id,
            model_name="yolo11m",
            review_state="unreviewed",
        )
        s.add(row)
        s.flush()
        return row.id


def _findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def _review(client, ctx, ids: list[str], action: str) -> None:
    r = client.post(f"{ctx['base']}/boxes/review", json={"box_ids": ids, "action": action})
    assert r.status_code == 200, r.text


def test_a_person_box_on_a_defect_type_is_an_open_finding(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert (f["status"], f["created_by"], f["severity"], f["confidence"]) == ("open", "human", 2, None)
    assert f["anchor"] == {"kind": "image", "image_id": ctx["image_id"], "annotation_id": box["id"]}
    assert (round(f["lon"], 3), round(f["lat"], 3)) == (15.2, 45.1)


def test_a_box_on_an_object_type_and_a_pending_proposal_are_no_findings(client, handle, ctx):
    _box(client, ctx, ctx["truck"])
    _proposal(handle, ctx, ctx["crack"])
    assert _findings(client, ctx) == []


def test_accepting_defect_proposals_makes_reviewed_findings_and_one_activity_row(client, handle, ctx):
    ids = [_proposal(handle, ctx, ctx["crack"]), _proposal(handle, ctx, ctx["crack"], model_id="m2")]
    _review(client, ctx, ids, "accept")
    found = _findings(client, ctx)
    assert sorted((f["status"], f["created_by"], f["confidence"]) for f in found) == [
        ("reviewed", "model:m1", 0.7),
        ("reviewed", "model:m2", 0.7),
    ]
    with handle.session() as s:
        rows = s.execute(select(Activity).where(Activity.kind == "detections.accepted")).scalars().all()
    assert len(rows) == 1 and rows[0].payload["count"] == 2


def test_editing_a_defect_proposal_makes_a_reviewed_finding(client, handle, ctx):
    bid = _proposal(handle, ctx, ctx["crack"])
    assert client.patch(f"{ctx['base']}/boxes/{bid}", json={"w": 25}).status_code == 200
    [f] = _findings(client, ctx)
    assert (f["status"], f["created_by"]) == ("reviewed", "model:m1")


def test_a_reclass_to_another_defect_type_moves_the_finding(client, ctx):
    from findings_helpers import add_type

    rust = add_type(client, "rust")
    box = _box(client, ctx, ctx["crack"])
    client.put(f"{ctx['base']}/types", json={"type_ids": [c["id"] for c in client.get(ctx["base"]).json()["classes"]] + [rust["id"]]})
    assert client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": rust["id"]}).status_code == 200
    [f] = _findings(client, ctx)
    assert (f["type_id"], f["number"]) == (rust["id"], 1)


def test_a_reclass_to_an_object_type_needs_confirmation(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    r = client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": ctx["truck"]})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "finding_would_be_deleted")
    assert len(_findings(client, ctx)) == 1
    r = client.patch(
        f"{ctx['base']}/boxes/{box['id']}", params={"confirm_finding_delete": "true"}, json={"class_id": ctx["truck"]}
    )
    assert r.status_code == 200 and r.json()["class_id"] == ctx["truck"]
    assert _findings(client, ctx) == []


def test_a_reclass_of_a_ground_truth_box_to_a_defect_type_makes_a_finding(client, ctx):
    box = _box(client, ctx, ctx["truck"])
    client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"class_id": ctx["crack"]})
    [f] = _findings(client, ctx)
    assert (f["status"], f["anchor"]["annotation_id"]) == ("open", box["id"])


def test_moving_a_box_leaves_its_finding_alone(client, ctx):
    box = _box(client, ctx, ctx["crack"])
    before = _findings(client, ctx)
    client.patch(f"{ctx['base']}/boxes/{box['id']}", json={"x": 50, "y": 60})
    after = _findings(client, ctx)
    assert [(f["id"], f["number"]) for f in after] == [(f["id"], f["number"]) for f in before]


def test_deleting_the_box_deletes_its_finding_and_bins_its_photos(client, handle, ctx, tmp_path, make_jpeg):
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    client.post(f"{ctx['base']}/findings/{f['id']}/attachments", json={"path": str(make_jpeg(tmp_path / "p.jpg", 64, 48))})
    assert client.delete(f"{ctx['base']}/boxes/{box['id']}").status_code == 204
    assert _findings(client, ctx) == []
    assert list((handle.folder / "findings" / "_trash").glob(f"{f['id']}-*"))


def test_deleting_the_finding_deletes_its_box(client, ctx):
    _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert client.delete(f"{ctx['base']}/findings/{f['id']}").status_code == 204
    assert client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"] == []


def test_unreviewing_an_accepted_defect_removes_its_finding(client, handle, ctx):
    bid = _proposal(handle, ctx, ctx["crack"])
    _review(client, ctx, [bid], "accept")
    [f] = _findings(client, ctx)
    client.post(f"{ctx['base']}/findings/{f['id']}/comments", json={"text": "check on site"})
    _review(client, ctx, [bid], "unreview")
    assert _findings(client, ctx) == []
    _review(client, ctx, [bid], "accept")
    assert [g["number"] for g in _findings(client, ctx)] == [2]


def test_rejecting_an_accepted_defect_removes_its_finding(client, handle, ctx):
    bid = _proposal(handle, ctx, ctx["crack"])
    _review(client, ctx, [bid], "accept")
    _review(client, ctx, [bid], "reject")
    assert _findings(client, ctx) == []


def test_bulk_image_delete_takes_the_findings_along(client, handle, ctx):
    _box(client, ctx, ctx["crack"])
    r = client.post(f"{ctx['base']}/images/bulk-delete", json={"image_ids": [ctx["image_id"]]})
    assert r.status_code == 200, r.text
    assert _findings(client, ctx) == []
    with handle.session() as s:
        assert [row for row in s.execute(select(FindingCount)).scalars() if row.n] == []


def test_an_unhooked_box_delete_fails_loudly(client, handle, ctx):
    box = _box(client, ctx, ctx["crack"])
    with pytest.raises(IntegrityError), handle.session() as s:
        s.execute(delete(Box).where(Box.id == box["id"]))


def test_post_findings_with_box_geometry_draws_the_box(client, ctx):
    body = {"type_id": ctx["crack"], "anchor": {"kind": "image", "image_id": ctx["image_id"], "box": {"x": 1, "y": 2, "w": 30, "h": 20}}}
    r = client.post(f"{ctx['base']}/findings", json=body)
    assert r.status_code == 201, r.text
    [box] = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert (box["id"], box["class_id"], box["review_state"]) == (r.json()["anchor"]["annotation_id"], ctx["crack"], "accepted")
    assert len(_findings(client, ctx)) == 1


def test_post_findings_on_an_existing_annotation(client, handle, ctx):
    truck_box = _box(client, ctx, ctx["truck"])
    anchor = {"kind": "image", "image_id": ctx["image_id"], "annotation_id": truck_box["id"]}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert r.status_code == 201, r.text
    boxes = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert boxes[0]["class_id"] == ctx["crack"]
    again = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": anchor})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "annotation_has_finding")
    pending = {"kind": "image", "image_id": ctx["image_id"], "annotation_id": _proposal(handle, ctx, ctx["truck"])}
    r = client.post(f"{ctx['base']}/findings", json={"type_id": ctx["crack"], "anchor": pending})
    assert (r.status_code, r.json()["error"]["code"]) == (409, "annotation_not_reviewed")


def test_changing_an_image_findings_type_moves_its_box(client, ctx):
    from findings_helpers import add_type

    rust = add_type(client, "rust")
    box = _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    assert client.patch(f"{ctx['base']}/findings/{f['id']}", json={"type_id": rust["id"]}).status_code == 200
    [moved] = client.get(f"{ctx['base']}/images/{ctx['image_id']}/boxes").json()["items"]
    assert (moved["id"], moved["class_id"]) == (box["id"], rust["id"])


def test_an_image_finding_has_a_crop_thumbnail(client, ctx):
    _box(client, ctx, ctx["crack"])
    [f] = _findings(client, ctx)
    r = client.get(f"{ctx['base']}/findings/{f['id']}/thumbnail")
    assert r.status_code == 200
    assert PILImage.open(BytesIO(r.content)).size == (160, 120)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_invariant.py -v`
Expected: FAIL. `test_a_person_box_on_a_defect_type_is_an_open_finding` finds `[]`;
`test_an_unhooked_box_delete_fails_loudly` already passes (the foreign key from Task 3).

- [ ] **Step 3: The hooks**

`backend/app/findings/annotations.py`:
```python
"""The annotation <-> finding invariant for image anchors (spec 2026-09-26-foundation section 8.5;
umbrella section 3: an annotation on a defect type IS a finding's geometry).

The box service (app/datasets/boxes.py) calls these hooks inside its own transaction, after it has
changed the box row. Each hook that deletes findings returns their ids, so the caller moves their
photos to the trash after the commit.
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Box, Finding, ProjectType
from app.errors import AppError
from app.findings import activity, numbers, service
from app.findings.anchors import AnchorIn

GROUND_TRUTH = ("accepted", "edited")


def created_by(box: Box) -> str:
    """`human` for a person-drawn box, else `model:<library model id>`. A cloud provider's box has
    no library model, so its provider name stands in."""
    if box.provenance_kind == "person":
        return "human"
    return f"model:{box.model_id or box.provider or 'unknown'}"


def _is_defect(s: Session, class_id: str) -> bool:
    row = s.get(ProjectType, class_id)
    return row is not None and row.kind == "defect"


def finding_of(s: Session, box_id: str) -> Finding | None:
    return s.execute(select(Finding).where(Finding.annotation_id == box_id)).scalar_one_or_none()


def _create(s: Session, project_id: str, catalogue, box: Box, *, record_activity: bool = True) -> Finding:
    """A person's box starts `open`; an accepted or edited detection is `reviewed`, with its model
    and confidence (the cross-host rule of spec section 8.5)."""
    return service.create_in_session(
        s,
        project_id=project_id,
        catalogue=catalogue,
        type_id=box.class_id,
        anchor=AnchorIn(kind="image", image_id=box.image_id, annotation_id=box.id),
        status="open" if box.provenance_kind == "person" else "reviewed",
        created_by=created_by(box),
        confidence=box.confidence,
        record_activity=record_activity,
    )


def on_box_created(s: Session, project_id: str, catalogue, box: Box) -> None:
    if box.review_state in GROUND_TRUTH and _is_defect(s, box.class_id):
        _create(s, project_id, catalogue, box)


def on_box_changed(
    s: Session,
    project_id: str,
    catalogue,
    box: Box,
    *,
    confirm_finding_delete: bool = False,
    accepted: list[str] | None = None,
) -> list[str]:
    """After a box's class or review state changed (the row carries the new values):

    - ground truth on a defect type, no finding yet -> a finding
    - no longer ground truth (rejected, or unreviewed again) -> its finding is deleted
    - reclassed to an object type -> its finding is deleted, but only with
      `confirm_finding_delete` (409 `finding_would_be_deleted` otherwise)
    - reclassed to another defect type -> the finding's type follows

    `accepted` collects a review batch's new findings for one `detections.accepted` row."""
    f = finding_of(s, box.id)
    ground_truth = box.review_state in GROUND_TRUTH
    defect = _is_defect(s, box.class_id)
    if f is None:
        if ground_truth and defect:
            new = _create(s, project_id, catalogue, box, record_activity=accepted is None)
            if accepted is not None:
                accepted.append(new.id)
        return []
    if not (ground_truth and defect):
        if ground_truth and not confirm_finding_delete:
            raise AppError(
                "finding_would_be_deleted",
                f"{numbers.format_number(f.number)} would be deleted: its new type is not a defect type.",
                409,
                {"finding_id": f.id, "number": f.number},
            )
        return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]
    if f.type_id != box.class_id:
        service.patch_in_session(
            s, project_id=project_id, catalogue=catalogue, finding_id=f.id, fields={"type_id": box.class_id}
        )
    return []


def on_box_deleting(s: Session, project_id: str, box: Box) -> list[str]:
    f = finding_of(s, box.id)
    if f is None:
        return []
    return [service.delete_in_session(s, project_id=project_id, finding_id=f.id, delete_annotation=False)]


def on_images_deleting(s: Session, project_id: str, image_ids: Iterable[str]) -> list[str]:
    """Before `images.bulk_delete` removes boxes with one SQL DELETE."""
    ids = list(
        s.execute(
            select(Finding.id).where(Finding.anchor_kind == "image", Finding.image_id.in_(list(image_ids)))
        ).scalars()
    )
    for fid in ids:
        service.delete_in_session(s, project_id=project_id, finding_id=fid, delete_annotation=False)
    return ids


def record_accepted(s: Session, finding_ids: list[str]) -> None:
    """One `detections.accepted` activity row per review request (spec section 8.5)."""
    if not finding_ids:
        return
    n = len(finding_ids)
    activity.record(
        s,
        "detections.accepted",
        None,
        f"{n} detection{'s' if n != 1 else ''} accepted as findings",
        {"finding_ids": finding_ids[:100], "count": n},
    )
```

- [ ] **Step 4: The box service calls the hooks**

Replace `backend/app/datasets/boxes.py` with:
```python
"""Box create, update, delete and bulk review (spec sections 4 and 6), and the annotation <-> finding
invariant (spec 2026-09-26-foundation section 8.5).

Accepted and edited boxes are ground truth; unreviewed proposals are not. Editing a proposal is
itself a review decision, so it becomes `edited` rather than staying pending. A ground-truth box on
a defect type is a finding's geometry: every write below calls `app.findings.annotations` inside its
own transaction, then moves the photos of findings it deleted to the trash after the commit.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.datasets.empties import clear_mark_for_ground_truth
from app.db.models import Box, Image, QueryRun
from app.detect.counts import Entry, apply_transition
from app.errors import AppError, not_found
from app.findings import annotations, trash
from app.geometry import centre_of, normalise_angle
from app.projects.service import ProjectHandle

GROUND_TRUTH = ("accepted", "edited")


def _entry(row: Box) -> Entry:
    return (row.class_id, row.review_state)


def _count_transition(
    s, runs: dict[str, QueryRun | None], run_id: str | None, old: Entry, new: Entry
) -> None:
    """Apply one box's change to its photo run's counts (spec 2026-09-23 section 9.1), in the caller's
    session so the review write and the increment share one transaction. A box outside any run, or
    in a run since deleted, changes nothing."""
    if not run_id or old == new:
        return
    if run_id not in runs:
        runs[run_id] = s.get(QueryRun, run_id)
    run = runs[run_id]
    if run is None:
        return
    counts, verified = dict(run.counts or {}), dict(run.verified_counts or {})
    apply_transition(counts, verified, old, new)
    run.counts, run.verified_counts = counts, verified  # new dicts: plain JSON does not track in place


def _image(s, image_id: str) -> Image:
    image = s.get(Image, image_id)
    if image is None:
        raise not_found("image", image_id)
    return image


def _check_class(handle: ProjectHandle, s, class_id: str) -> None:
    if class_id not in {c["id"] for c in handle.row(s).classes or []}:
        raise AppError("validation_error", f"unknown class {class_id!r}", 422)


def _check_bounds(image: Image, x: float, y: float, w: float, h: float, angle: float = 0.0) -> None:
    """Angle 0 must lie fully inside the image; a rotated box only needs its centre inside.

    The asymmetry is deliberate (spec 3.3). Forcing a rotated box's corners inside the image would
    shrink or shove it every time the annotator rotated near an edge, and an object half out of
    frame is exactly the case aerial frames are full of. Angle 0 keeps today's rule untouched so
    no box that already exists changes meaning.
    """
    if w <= 0 or h <= 0:
        raise AppError("validation_error", f"box ({x}, {y}, {w}, {h}) has a non-positive side", 422)
    if angle:
        cx, cy = centre_of(x, y, w, h)
        if not (0 <= cx <= image.width and 0 <= cy <= image.height):
            raise AppError(
                "validation_error",
                f"rotated box centre ({cx}, {cy}) is outside the {image.width}x{image.height} image",
                422,
            )
        return
    if x < 0 or y < 0 or x + w > image.width or y + h > image.height:
        raise AppError(
            "validation_error",
            f"box ({x}, {y}, {w}, {h}) does not lie inside the {image.width}x{image.height} image",
            422,
        )


def list_boxes(handle: ProjectHandle, image_id: str) -> list[Box]:
    with handle.session() as s:
        _image(s, image_id)
        rows = list(
            s.execute(select(Box).where(Box.image_id == image_id).order_by(Box.created_at, Box.id)).scalars()
        )
        for r in rows:
            s.expunge(r)
    return rows


def create_box_in_session(
    s,
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float = 0.0,
    query_run_id: str | None = None,
) -> Box:
    """A person-drawn box in the caller's transaction, without the finding hook: `POST /findings`
    draws its box through here and creates the finding itself."""
    image = _image(s, image_id)
    _check_class(handle, s, class_id)
    angle = normalise_angle(angle)
    _check_bounds(image, x, y, w, h, angle)
    row = Box(
        image_id=image_id,
        class_id=class_id,
        x=x,
        y=y,
        w=w,
        h=h,
        angle=angle,
        provenance_kind="person",
        review_state="accepted",
        reviewed_at=datetime.now(UTC),
        query_run_id=query_run_id,
    )
    s.add(row)
    _count_transition(s, {}, query_run_id, None, _entry(row))
    clear_mark_for_ground_truth(s, [image_id])
    s.flush()
    return row


def create_box(
    handle: ProjectHandle,
    image_id: str,
    class_id: str,
    x: float,
    y: float,
    w: float,
    h: float,
    angle: float = 0.0,
    query_run_id: str | None = None,
) -> Box:
    """A person-drawn box; with `query_run_id` it is a missed object added to that photo run and
    counts in it as verified. On a defect type it is also an open finding."""
    with handle.session() as s:
        row = create_box_in_session(s, handle, image_id, class_id, x, y, w, h, angle, query_run_id)
        annotations.on_box_created(s, handle.id, handle.catalogue, row)
        s.flush()
        s.expunge(row)
    return row


def update_box(handle: ProjectHandle, box_id: str, *, confirm_finding_delete: bool = False, **fields) -> Box:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        if "class_id" in fields:
            _check_class(handle, s, fields["class_id"])
        if "angle" in fields:
            fields["angle"] = normalise_angle(fields["angle"])
        moved = {k: fields.get(k, getattr(row, k)) for k in ("x", "y", "w", "h", "angle")}
        _check_bounds(_image(s, row.image_id), **moved)
        old = _entry(row)
        for k, v in fields.items():
            setattr(row, k, v)
        if row.review_state not in GROUND_TRUTH:  # editing a proposal is a review decision
            row.review_state = "edited"
            row.reviewed_at = datetime.now(UTC)
            clear_mark_for_ground_truth(s, [row.image_id])
        _count_transition(s, {}, row.query_run_id, old, _entry(row))
        trashed = annotations.on_box_changed(
            s, handle.id, handle.catalogue, row, confirm_finding_delete=confirm_finding_delete
        )
        s.flush()
        s.expunge(row)
    trash.move(handle, trashed)
    return row


def reclass_in_session(s, box_id: str, class_id: str) -> None:
    """A finding's type change moves its box (an annotation's type is its finding's type), with the
    photo run's counts. No finding hook runs: the finding already follows."""
    row = s.get(Box, box_id)
    if row is None or row.class_id == class_id:
        return
    old = _entry(row)
    row.class_id = class_id
    _count_transition(s, {}, row.query_run_id, old, _entry(row))


def delete_box_in_session(s, row: Box) -> None:
    """The box and its run count, without the finding hook: a finding delete calls this after it has
    removed itself."""
    _count_transition(s, {}, row.query_run_id, _entry(row), None)
    s.delete(row)


def delete_box(handle: ProjectHandle, box_id: str) -> None:
    with handle.session() as s:
        row = s.get(Box, box_id)
        if row is None:
            raise not_found("box", box_id)
        trashed = annotations.on_box_deleting(s, handle.id, row)
        delete_box_in_session(s, row)
    trash.move(handle, trashed)


def review_boxes(handle: ProjectHandle, box_ids: list[str], action: str) -> int:
    """Accept, reject or unreview proposals in bulk; the count is the boxes that changed state.

    Unknown ids and person-drawn boxes are ignored: only a model proposal has a decision to make
    or undo. Accepting an already edited box leaves it `edited` — it is ground truth either way,
    and the state records that a person changed its geometry. An accepted defect proposal becomes
    a `reviewed` finding; rejecting or unreviewing it removes that finding again.
    """
    now = datetime.now(UTC)
    changed = 0
    accepted_image_ids: set[str] = set()
    runs: dict[str, QueryRun | None] = {}
    new_findings: list[str] = []
    trashed: list[str] = []
    with handle.session() as s:
        for row in s.execute(select(Box).where(Box.id.in_(box_ids))).scalars():
            if row.provenance_kind == "person":
                continue
            old = _entry(row)
            if action == "unreview":
                if row.review_state == "unreviewed":
                    continue
                row.review_state, row.reviewed_at = "unreviewed", None
            else:
                target = "accepted" if action == "accept" else "rejected"
                if row.review_state == target or (action == "accept" and row.review_state in GROUND_TRUTH):
                    continue
                row.review_state, row.reviewed_at = target, now
                if action == "accept":
                    accepted_image_ids.add(row.image_id)
            _count_transition(s, runs, row.query_run_id, old, _entry(row))
            trashed += annotations.on_box_changed(s, handle.id, handle.catalogue, row, accepted=new_findings)
            changed += 1
        clear_mark_for_ground_truth(s, accepted_image_ids)
        annotations.record_accepted(s, new_findings)
    trash.move(handle, trashed)
    return changed
```

`backend/app/datasets/images.py`, `bulk_delete`:
1. Add `from app.findings import annotations, trash` to the imports.
2. Directly before `s.execute(delete(Box).where(Box.image_id.in_([r.id for r in rows])))` add
   `trashed = annotations.on_images_deleting(s, handle.id, [r.id for r in rows])`.
3. Directly before the `for p in paths + derived:` loop (after the `with` block) add
   `trash.move(handle, trashed)`.

`backend/app/datasets/router.py`, `update_box` route: add the parameter
`confirm_finding_delete: bool = Query(False),` and call
`boxes.update_box(handle, boxId, confirm_finding_delete=confirm_finding_delete, **body.model_dump(exclude_unset=True))`.
Add `Query` to the `fastapi` import if the file lacks it.

- [ ] **Step 5: The finding service drives the box**

In `backend/app/findings/service.py`:
1. Imports: `from dataclasses import replace` and add `Box` to the `app.db.models` import.
2. In `delete_in_session`, replace the body with:
```python
    row = _get(s, finding_id)
    annotation_id = row.annotation_id
    counts.change(s, counts.key_of(row), None)
    s.delete(row)
    s.flush()  # the finding goes before the box it references
    if delete_annotation and annotation_id:
        from app.datasets import boxes  # boxes imports this package's hooks

        box = s.get(Box, annotation_id)
        if box is not None:
            boxes.delete_box_in_session(s, box)
    events.mark_changed(s, project_id, [finding_id])
    return finding_id
```
3. In `patch_in_session`, replace `if pt is not None:\n        row.type_id = pt.type_id` with:
```python
    if pt is not None:
        row.type_id = pt.type_id
        if row.anchor_kind == "image" and row.annotation_id:
            from app.datasets import boxes

            boxes.reclass_in_session(s, row.annotation_id, pt.type_id)
```
4. Replace `create_finding` with:
```python
def _image_annotation(s: Session, handle, anchor: AnchorIn, type_id: str) -> AnchorIn:
    """`POST /findings` on an image: draw its box (`box`), or adopt a ground-truth box
    (`annotation_id`), whose type becomes the finding's type."""
    from app.datasets import boxes

    defect_type(s, handle.catalogue, type_id)  # refuse an object type before a box is drawn
    if anchor.box is not None:
        box = boxes.create_box_in_session(s, handle, anchor.image_id, type_id, **anchor.box)
        return replace(anchor, annotation_id=box.id, box=None)
    box = s.get(Box, anchor.annotation_id) if anchor.annotation_id else None
    if box is not None and box.review_state not in ("accepted", "edited"):
        raise AppError(
            "annotation_not_reviewed",
            "Accept or edit that detection first; a pending one is not a finding yet.",
            409,
            {"annotation_id": box.id},
        )
    if box is not None and box.class_id != type_id:
        boxes.reclass_in_session(s, box.id, type_id)
    return anchor


def create_finding(handle, **kw) -> Finding:
    """`create_in_session` in its own transaction (the HTTP route); an image anchor may draw or adopt
    its box first (spec section 8.3)."""
    with handle.session() as s:
        if kw["anchor"].kind == "image":
            kw["anchor"] = _image_annotation(s, handle, kw["anchor"], kw["type_id"])
        row = create_in_session(s, project_id=handle.id, catalogue=handle.catalogue, **kw)
        s.flush()
        s.expunge(row)
    return row
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_invariant.py tests/test_boxes.py tests/test_images.py tests/test_detect_review.py tests/test_findings_service.py tests/test_findings_api.py -v`
Expected: all pass. Then the whole suite: `& $PY -m pytest -q -p no:cacheprovider`; the only
failure left is the contract's `getProjectOverview`.

- [ ] **Step 7: Lint and commit**

```powershell
& $PY -m ruff format app/findings app/datasets tests/test_findings_invariant.py
& $PY -m ruff check app/findings app/datasets tests/test_findings_invariant.py
cd ..
git add backend/app/findings/annotations.py backend/app/findings/service.py backend/app/datasets/boxes.py backend/app/datasets/images.py backend/app/datasets/router.py backend/tests/test_findings_invariant.py
git commit -m @'
feat(findings): an annotation on a defect type is a finding's geometry

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 12: The defect backfill

**Files:**
- Create: `backend/app/findings/backfill.py`
- Modify: `backend/app/catalogue/router.py` (`POST /catalogue/types/{typeId}/backfill`), `backend/tests/test_contract.py` (stub entry, if any)
- Test: `backend/tests/test_findings_backfill.py`

**Interfaces:**
- Consumes: Task 11 `annotations.GROUND_TRUTH`, `annotations.created_by`; Task 7 `service.create_in_session`; Task 6 `numbers.allocate`, `activity.record`; Task 5 `project_types.refresh_snapshots`; `ctx.runner.projects` (the registry, wired in `lifespan` and kept by BK); `app.library.handle.get_library`; `app.jobs.cancellation.JobCancelled, JobFailure`.
- Produces: `findings_from_annotations(handle, type_ids=None, *, batch=1000, progress=None, check_cancelled=None) -> int` (MG's migration step 6 calls it with `type_ids=None`); job type `findings_backfill` on the **library** runner with params `{type_id}` and result `{type_id, created, projects: [{project, project_id?, created, skipped?}]}`; `BACKFILL_JOB`; the route `POST /catalogue/types/{typeId}/backfill` → 202 `JobRef` (409-free: it is idempotent), 422 `not_a_defect`, 503 `catalogue_unavailable` / `library_unavailable`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_findings_backfill.py`:
```python
"""Re-marking a type `defect` and backfilling (spec 2026-09-26-foundation section 7.2, decision F4,
section 11.4 step 6): accepted and person-drawn boxes of that type become `reviewed` findings with no
severity, numbered in box order, once."""

import pytest
from findings_helpers import add_type, use_types
from library_helpers import wait_library_job

from app.db.models import Box
from app.findings.backfill import findings_from_annotations

API = "/api/v1"
TYPES = f"{API}/catalogue/types"


@pytest.fixture
def ctx(client, project, handle, import_source, tmp_path, make_jpeg) -> dict:
    """An object type `pothole` with a person box, an accepted, a pending and a rejected proposal."""
    pothole = add_type(client, "pothole", kind="object")
    use_types(client, project, pothole)
    folder = tmp_path / "frames"
    make_jpeg(folder / "S_0001_0001.jpg", 320, 240, seed=1)
    import_source(project["id"], folder)
    base = f"{API}/projects/{project['id']}"
    image_id = client.get(f"{base}/images").json()["items"][0]["id"]
    r = client.post(f"{base}/images/{image_id}/boxes", json={"class_id": pothole["id"], "x": 1, "y": 1, "w": 10, "h": 10})
    assert r.status_code == 201, r.text
    with handle.session() as s:
        for state in ("accepted", "unreviewed", "rejected"):
            s.add(
                Box(
                    image_id=image_id,
                    class_id=pothole["id"],
                    x=20,
                    y=20,
                    w=10,
                    h=10,
                    confidence=0.9,
                    provenance_kind="local_model",
                    model_id="m1",
                    review_state=state,
                )
            )
    return {"base": base, "type_id": pothole["id"]}


def _findings(client, ctx) -> list[dict]:
    return client.get(f"{ctx['base']}/findings", params={"sort": "number"}).json()["items"]


def _backfill(client, ctx) -> dict:
    r = client.post(f"{TYPES}/{ctx['type_id']}/backfill")
    assert r.status_code == 202, r.text
    job = wait_library_job(client, r.json()["job"]["id"])
    assert job["state"] == "succeeded", job
    return job["result"]


def test_marking_a_type_defect_and_backfilling_makes_reviewed_findings(client, ctx):
    r = client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    assert r.json()["backfill_candidates"] is True
    assert _findings(client, ctx) == []  # the kind change alone creates nothing (F4)
    assert _backfill(client, ctx)["created"] == 2
    found = _findings(client, ctx)
    assert [(f["number"], f["status"], f["severity"], f["created_by"]) for f in found] == [
        (1, "reviewed", None, "human"),
        (2, "reviewed", None, "model:m1"),
    ]
    assert _backfill(client, ctx)["created"] == 0
    assert len(_findings(client, ctx)) == 2


def test_an_object_type_cannot_be_backfilled(client, ctx):
    r = client.post(f"{TYPES}/{ctx['type_id']}/backfill")
    assert (r.status_code, r.json()["error"]["code"]) == (422, "not_a_defect")


def test_a_missing_recent_folder_is_reported_and_skipped(client, app, ctx, tmp_path):
    app.state.projects.appdata.remember("gone-id", "Gone", str(tmp_path / "gone"))
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    result = _backfill(client, ctx)
    assert {"project": "Gone", "created": 0, "skipped": "folder_missing"} in result["projects"]
    assert result["created"] == 2


def test_the_function_pages_in_batches(client, handle, ctx):
    client.patch(f"{TYPES}/{ctx['type_id']}", json={"kind": "defect"})
    seen: list[tuple[int, int]] = []
    assert findings_from_annotations(handle, [ctx["type_id"]], batch=1, progress=lambda d, t: seen.append((d, t))) == 2
    assert seen == [(1, 2), (2, 2)]
    assert findings_from_annotations(handle, [ctx["type_id"]]) == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_findings_backfill.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.findings.backfill'`.

- [ ] **Step 3: Implement**

`backend/app/findings/backfill.py`:
```python
"""The defect backfill (spec 2026-09-26-foundation sections 7.2, 11.4 step 6; decision F4).

`findings_from_annotations` applies D6's rule, "accepted boxes become findings, Reviewed, no
severity", to the ground-truth and person-drawn boxes of defect types that have no finding yet. It is
idempotent: a re-run after a crash, or a second backfill, only fills the gaps. MG's migration step 6
calls it too. `findings_backfill` is the library job the Catalogue offers when a type is re-marked
`defect`; it walks the recent projects one at a time.
"""

from collections.abc import Callable, Sequence
from pathlib import Path

from sqlalchemy import func, or_, select

from app.catalogue import project_types
from app.db.models import Box, Finding, ProjectType
from app.findings import activity, annotations, numbers, service
from app.findings.anchors import AnchorIn
from app.jobs.cancellation import JobCancelled, JobFailure
from app.jobs.registry import register_job_type

BATCH = 1000
BACKFILL_JOB = "findings_backfill"


def _candidates(type_ids: Sequence[str]):
    has_finding = select(Finding.id).where(Finding.annotation_id == Box.id).exists()
    return select(Box).where(
        Box.class_id.in_(list(type_ids)),
        or_(Box.review_state.in_(annotations.GROUND_TRUTH), Box.provenance_kind == "person"),
        ~has_finding,
    )


def findings_from_annotations(
    handle,
    type_ids: Sequence[str] | None = None,
    *,
    batch: int = BATCH,
    progress: Callable[[int, int], None] | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> int:
    """Create the missing findings, `batch` boxes per transaction, numbered in box `created_at`
    order; returns how many were created. `type_ids=None` means every defect type of the project."""
    with handle.session() as s:
        project_types.refresh_snapshots(s, handle.catalogue, type_ids)
        q = select(ProjectType.type_id).where(ProjectType.kind == "defect")
        if type_ids is not None:
            q = q.where(ProjectType.type_id.in_(list(type_ids)))
        defect_ids = list(s.execute(q).scalars())
        total = 0
        if defect_ids:
            total = s.execute(select(func.count()).select_from(_candidates(defect_ids).subquery())).scalar_one()
    done = 0
    for _ in range(total // batch + 2):  # a bound: never an endless loop
        if done >= total:
            break
        if check_cancelled is not None:
            check_cancelled()
        with handle.session() as s:
            rows = s.execute(_candidates(defect_ids).order_by(Box.created_at, Box.id).limit(batch)).scalars().all()
            if not rows:
                break
            first = numbers.allocate(s, count=len(rows))
            for i, box in enumerate(rows):
                service.create_in_session(
                    s,
                    project_id=handle.id,
                    catalogue=handle.catalogue,
                    type_id=box.class_id,
                    anchor=AnchorIn(kind="image", image_id=box.image_id, annotation_id=box.id),
                    severity=None,
                    status="reviewed",
                    created_by=annotations.created_by(box),
                    confidence=box.confidence,
                    created_at=box.created_at,
                    number=first + i,
                    record_activity=False,
                )
            done += len(rows)
        if progress is not None:
            progress(done, total)
    if done:
        with handle.session() as s:
            activity.record(s, "finding.created", None, f"Created {done} findings from accepted annotations", {"count": done})
    return done


@register_job_type(BACKFILL_JOB)
def run_backfill(ctx) -> dict:
    """Library job: every recent project, one at a time. A project that cannot be opened is reported
    and skipped; the job still succeeds for the others."""
    registry = getattr(ctx.runner, "projects", None)
    if registry is None:
        raise JobFailure("The project list is not available to this job.")
    type_id = ctx.params["type_id"]
    recent = registry.recent()
    report: list[dict] = []
    created = 0
    for i, entry in enumerate(recent):
        ctx.check_cancelled()
        ctx.progress(i / max(len(recent), 1), f"Looking at {entry['name']}")
        folder = Path(entry["folder"])
        if not (folder / "project.db").exists():
            report.append({"project": entry["name"], "created": 0, "skipped": "folder_missing"})
            continue
        try:
            handle = registry.open(folder, remember=False)
            n = findings_from_annotations(
                handle,
                [type_id],
                check_cancelled=ctx.check_cancelled,
                progress=lambda done, total, i=i, name=entry["name"]: ctx.progress(
                    (i + done / total) / len(recent), f"{name}: {done} of {total}"
                ),
            )
        except JobCancelled:
            raise
        except Exception as e:
            ctx.log.exception("the backfill failed in %s", folder)
            report.append({"project": entry["name"], "created": 0, "skipped": f"{type(e).__name__}: {e}"})
            continue
        created += n
        report.append({"project": entry["name"], "project_id": handle.id, "created": n})
    ctx.progress(1, f"Created {created} findings")
    return {"type_id": type_id, "created": created, "projects": report}
```

Append to `backend/app/catalogue/router.py` (with the imports `from app.errors import AppError`,
`from app.findings.backfill import BACKFILL_JOB`, `from app.jobs.schemas import JobOut`,
`from app.library.handle import LibraryHandle, get_library`, `from app.training.schemas import JobRef`):
```python
@router.post("/types/{typeId}/backfill", response_model=JobRef, status_code=202)
def backfill_catalogue_type(
    typeId: str,  # noqa: N803
    request: Request,
    cat: CatalogueHandle = Depends(get_catalogue),
    lib: LibraryHandle = Depends(get_library),
) -> JobRef:
    """`findings_backfill` on the library runner (spec section 7.2). Idempotent: a second run only
    fills gaps, so it is never refused as a duplicate."""
    ref = service.get_type(cat, typeId)
    if ref.kind != "defect":
        raise AppError("not_a_defect", f"{ref.name} is an object type; mark it a defect first.", 422, {"type_id": typeId})
    job = request.app.state.jobs.submit(lib, BACKFILL_JOB, {"type_id": typeId})
    return JobRef(job=JobOut.from_row(job, lib.id))
```
Delete C0's stub and `EXPECTED_STUBS` entry for `backfillCatalogueType` if Task 1 found one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_findings_backfill.py tests/test_catalogue_api.py -v`
Expected: all pass.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app/findings app/catalogue tests/test_findings_backfill.py tests/test_contract.py
& $PY -m ruff check app/findings app/catalogue tests/test_findings_backfill.py tests/test_contract.py
cd ..
git add backend/app/findings/backfill.py backend/app/catalogue/router.py backend/tests/test_findings_backfill.py backend/tests/test_contract.py
git commit -m @'
feat(findings): findings_backfill library job when a type becomes a defect

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 13: The Overview endpoint and `ProjectOut.summary`

**Files:**
- Create: `backend/app/overview/__init__.py`, `backend/app/overview/schemas.py`, `backend/app/overview/service.py`, `backend/app/overview/router.py`
- Modify: `backend/app/projects/schemas.py` (`ProjectOut.summary`), `backend/app/projects/router.py` (BK's `_out` fills it; every `ProjectOut` goes through `_out`), `backend/app/api.py`, `backend/tests/test_contract.py`
- Test: `backend/tests/test_overview.py`

**Interfaces:**
- Consumes: Task 8 `query.summary`; Task 6 `counts.open_now`; Task 2 `catalogue_service.scale_levels`, `get_meta`, `NEEDS_CLASSIFICATION`; `app.library.adoption.adoption_status(handle) -> {pending, adopted, missing, job_id}`; Task 3 and earlier models (`Source`, `GeoMap`, `Surface`, `PointCloud`, `VolumeMeasurement`).
- Produces: `GET /projects/{projectId}/overview` → `ProjectOverview`; `overview.service.build(handle) -> dict`, `data_counts(s) -> dict`, `latest_volume(s) -> dict | None`, `hero_map_id(s) -> str | None`, `project_summary(s, top_level) -> dict`, `BANNER_PROVIDERS` and the decorator `banner_provider(fn)` (MG registers its migration banner with it); `ProjectOut.summary: ProjectSummary`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_overview.py`:
```python
"""The project Overview (spec 2026-09-26-foundation sections 9.1, 9.2, 14, 16): one endpoint, fed by
pre-aggregated rows only. A statement counter pins that its cost does not grow with the project and
that it never reads `finding`, `box` or `image`."""

import re
from collections.abc import Callable
from datetime import UTC, date, datetime

import pytest
from findings_helpers import insert_cloud
from sqlalchemy import event

from app.catalogue import service as catalogue_service
from app.db.models import GeoMap, Surface, VolumeMeasurement
from app.findings import service
from app.findings.anchors import AnchorIn
from app.overview import service as overview

API = "/api/v1"
FORBIDDEN = re.compile(r"\b(FROM|JOIN)\s+\"?(finding|box|image)\"?(\s|$)", re.IGNORECASE)


def _overview(client, project) -> dict:
    r = client.get(f"{API}/projects/{project['id']}/overview")
    assert r.status_code == 200, r.text
    return r.json()


def _counting(engine) -> tuple[list[str], Callable[[], None]]:
    seen: list[str] = []

    def before(conn, cursor, statement, params, context, executemany):
        if not statement.lstrip().upper().startswith("PRAGMA"):
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    return seen, lambda: event.remove(engine, "before_cursor_execute", before)


def _map(handle, name: str, status: str, captured_on: date | None) -> str:
    with handle.session() as s:
        row = GeoMap(name=name, status=status, source_path="C:/m.tif", source_size=1, captured_on=captured_on)
        s.add(row)
        s.flush()
        return row.id


def test_an_empty_project(client, project):
    out = _overview(client, project)
    assert out["data"] == {"image_sets": 0, "images": 0, "maps": 0, "elevations": 0, "point_clouds": 0, "drawings": 0}
    assert (out["latest_volume"], out["hero_map_id"], out["banners"]) == (None, None, [])
    assert out["findings"]["by_status"] == {"open": 0, "reviewed": 0, "closed": 0}
    assert out["findings"]["open_by_severity"] == {"1": 0, "2": 0, "3": 0, "4": 0}


def test_the_overview_costs_the_same_whatever_the_project_holds(client, project, handle, crack):
    seen, stop = _counting(handle.engine)
    try:
        _overview(client, project)
    finally:
        stop()
    empty = list(seen)
    cloud = insert_cloud(handle)
    for sev in [None, 1, 2, 3, 4] * 6:
        service.create_finding(handle, type_id=crack["id"], anchor=AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0), severity=sev)
    _map(handle, "April", "ready", date(2026, 4, 1))
    seen, stop = _counting(handle.engine)
    try:
        out = _overview(client, project)
    finally:
        stop()
    assert len(seen) == len(empty), (empty, seen)
    assert [st for st in seen if FORBIDDEN.search(st)] == []
    assert out["findings"]["by_status"]["open"] == 30


def test_the_hero_map_is_the_newest_ready_map(client, project, handle):
    _map(handle, "March", "ready", date(2026, 3, 1))
    april = _map(handle, "April", "ready", date(2026, 4, 1))
    _map(handle, "May", "importing", date(2026, 5, 1))
    _map(handle, "Undated", "ready", None)
    assert _overview(client, project)["hero_map_id"] == april


def test_the_latest_volume_and_its_delta_on_the_same_polygon(client, project, handle):
    poly = [[0, 0], [10, 0], [10, 10], [0, 0]]
    with handle.session() as s:
        top = Surface(name="Design", kind="design", status="ready")
        s.add(top)
        s.flush()
        for name, polygon, net, day in [
            ("Pile A", poly, 100.0, 1),
            ("Pile B", [[5, 5], [6, 5], [6, 6], [5, 5]], 7.0, 10),
            ("Pile A again", poly, 130.0, 20),
        ]:
            s.add(
                VolumeMeasurement(
                    name=name,
                    polygon_native=polygon,
                    top_surface_id=top.id,
                    base={"kind": "lowest"},
                    status="ready",
                    results={"net_m3": net},
                    created_at=datetime(2026, 9, day, tzinfo=UTC),
                )
            )
    out = _overview(client, project)
    lv = out["latest_volume"]
    assert (lv["name"], lv["net_m3"], lv["previous_net_m3"]) == ("Pile A again", 130.0, 100.0)
    assert out["data"]["elevations"] == 1


def test_banners_and_a_failing_provider(client, project, monkeypatch):
    catalogue_service.set_meta(client.app.state.catalogue, catalogue_service.NEEDS_CLASSIFICATION, {"count": 12})

    def broken(handle):
        raise RuntimeError("boom")

    monkeypatch.setattr(overview, "BANNER_PROVIDERS", [*overview.BANNER_PROVIDERS, broken])
    [banner] = _overview(client, project)["banners"]
    assert banner["kind"] == "types_to_classify"
    assert banner["message"].startswith("12 types came from your existing projects")


def test_project_out_carries_the_summary(client, project, handle, crack):
    cloud = insert_cloud(handle)
    anchor = AnchorIn(kind="cloud", cloud_id=cloud, x=0.0, y=0.0, z=0.0)
    service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=4)
    service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=None)
    closed = service.create_finding(handle, type_id=crack["id"], anchor=anchor, severity=4)
    service.patch_finding(handle, closed.id, {"status": "closed"})
    mid = _map(handle, "April", "ready", date(2026, 4, 1))
    summary = client.get(f"{API}/projects/{project['id']}").json()["summary"]
    assert summary == {
        "image_count": 0,
        "maps": 1,
        "point_clouds": 1,
        "elevations": 0,
        "open_findings": 2,
        "open_top_severity": 1,
        "cover": {"kind": "map", "id": mid},
    }
    listed = client.get(f"{API}/projects").json()["items"]
    assert [p["summary"]["open_findings"] for p in listed if p["id"] == project["id"]] == [2]


@pytest.mark.parametrize("path", ["", "/types"])
def test_every_project_response_carries_the_summary(client, project, path):
    if path:
        r = client.put(f"{API}/projects/{project['id']}{path}", json={"type_ids": [c["id"] for c in project["classes"]]})
    else:
        r = client.patch(f"{API}/projects/{project['id']}", json={"name": "Renamed"})
    assert r.status_code == 200, r.text
    assert r.json()["summary"]["open_findings"] == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `& $PY -m pytest tests/test_overview.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.overview'`.

- [ ] **Step 3: Implement**

`backend/app/overview/__init__.py`:
```python
"""The project Overview dashboard's one endpoint (spec 2026-09-26-foundation section 9.1)."""
```

`backend/app/overview/schemas.py`:
```python
"""Pydantic shapes of ProjectOverview and ProjectSummary in contract/openapi.yaml."""

from typing import Literal

from pydantic import BaseModel

from app.findings.schemas import FindingSummary


class DataCounts(BaseModel):
    image_sets: int
    images: int
    maps: int
    elevations: int
    point_clouds: int
    drawings: int


class LatestVolume(BaseModel):
    measurement_id: str
    name: str
    net_m3: float | None
    previous_net_m3: float | None  # the previous ready measurement over the same polygon


class Banner(BaseModel):
    kind: str
    tone: Literal["info", "warn", "danger"]
    message: str
    action: str | None = None


class ProjectOverview(BaseModel):
    findings: FindingSummary
    data: DataCounts
    latest_volume: LatestVolume | None
    hero_map_id: str | None
    banners: list[Banner]


class Cover(BaseModel):
    kind: Literal["map", "image"]
    id: str


class ProjectSummary(BaseModel):
    image_count: int
    maps: int
    point_clouds: int
    elevations: int
    open_findings: int
    open_top_severity: int
    cover: Cover | None
```

`backend/app/overview/service.py`:
```python
"""The Overview (spec 2026-09-26-foundation section 9.1) and the Projects list summary (section
9.2), from pre-aggregated rows only: `finding_count`, `finding_daily`, the type snapshots, small-table
COUNTs and SUM(source.image_count). Nothing here reads `finding`, `box` or `image` (a statement
counter in tests/test_overview.py pins it), except `project_summary`'s cover, which takes the newest
image by rowid: one row, no scan."""

import logging
from collections.abc import Callable

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.catalogue import service as catalogue_service
from app.db.models import GeoMap, PointCloud, Source, Surface, VolumeMeasurement
from app.findings import counts, query

LATEST_VOLUME_WINDOW = 21  # the newest ready measurement and the 20 before it, looking for its polygon
log = logging.getLogger(__name__)

BANNER_PROVIDERS: list[Callable] = []


def banner_provider(fn: Callable) -> Callable:
    """Register `fn(handle) -> list[banner dict]`; MG adds its migration banner this way."""
    BANNER_PROVIDERS.append(fn)
    return fn


def data_counts(s: Session) -> dict:
    """One statement: the data chips of KPI 3 (spec section 9.1)."""
    row = s.execute(
        select(
            select(func.count()).select_from(Source).where(Source.kind == "images").scalar_subquery().label("image_sets"),
            select(func.coalesce(func.sum(Source.image_count), 0))
            .where(Source.kind == "images")
            .scalar_subquery()
            .label("images"),
            select(func.count()).select_from(GeoMap).scalar_subquery().label("maps"),
            select(func.count()).select_from(Surface).scalar_subquery().label("elevations"),
            select(func.count()).select_from(PointCloud).scalar_subquery().label("point_clouds"),
        )
    ).one()
    return {**row._asdict(), "drawings": 0}  # M adds the drawing table and its count


def hero_map_id(s: Session) -> str | None:
    """The newest ready map by capture date (undated last), then by import."""
    return s.execute(
        select(GeoMap.id)
        .where(GeoMap.status == "ready")
        .order_by(GeoMap.captured_on.is_(None), GeoMap.captured_on.desc(), GeoMap.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def latest_volume(s: Session) -> dict | None:
    """KPI 4: the newest ready volume measurement's net volume, and the previous ready measurement's
    over the same polygon (the client shows the delta)."""
    rows = (
        s.execute(
            select(VolumeMeasurement)
            .where(VolumeMeasurement.status == "ready")
            .order_by(VolumeMeasurement.created_at.desc(), VolumeMeasurement.id.desc())
            .limit(LATEST_VOLUME_WINDOW)
        )
        .scalars()
        .all()
    )
    if not rows:
        return None
    newest = rows[0]
    previous = next((r for r in rows[1:] if r.polygon_native == newest.polygon_native), None)
    return {
        "measurement_id": newest.id,
        "name": newest.name,
        "net_m3": (newest.results or {}).get("net_m3"),
        "previous_net_m3": (previous.results or {}).get("net_m3") if previous is not None else None,
    }


@banner_provider
def _types_to_classify(handle) -> list[dict]:
    if handle.catalogue is None:
        return []
    flag = catalogue_service.get_meta(handle.catalogue, catalogue_service.NEEDS_CLASSIFICATION)
    if not flag:
        return []
    n = flag.get("count") if isinstance(flag, dict) else None
    lead = f"{n} types came" if n else "Some types came"
    return [
        {
            "kind": "types_to_classify",
            "tone": "info",
            "message": f"{lead} from your existing projects. Mark which are defects.",
            "action": "/catalogue?origin=migrated",
        }
    ]


@banner_provider
def _model_adoption(handle) -> list[dict]:
    from app.library import adoption  # the library package is optional at import time

    status = adoption.adoption_status(handle)
    if status["missing"]:
        n = len(status["missing"])
        return [
            {
                "kind": "model_adoption",
                "tone": "warn",
                "message": f"{n} of this project's models could not be moved into the library.",
                "action": "/models/library",
            }
        ]
    if status["pending"]:
        return [
            {
                "kind": "model_adoption",
                "tone": "info",
                "message": f"Moving {status['pending']} of this project's models into the library.",
                "action": None,
            }
        ]
    return []


def build(handle) -> dict:
    levels = catalogue_service.scale_levels(handle.catalogue)
    with handle.session() as s:
        payload = {
            "findings": query.summary(s, levels=levels),
            "data": data_counts(s),
            "latest_volume": latest_volume(s),
            "hero_map_id": hero_map_id(s),
        }
    banners: list[dict] = []
    for provider in BANNER_PROVIDERS:
        try:
            banners += provider(handle)
        except Exception:  # a banner is never the reason the Overview fails
            log.exception("overview banner %s failed for project %s", getattr(provider, "__name__", provider), handle.id)
    return {**payload, "banners": banners}


def project_summary(s: Session, top_level: int) -> dict:
    """`ProjectOut.summary` (spec section 9.2): the same pre-aggregated reads."""
    data = data_counts(s)
    open_total, by_level = counts.open_now(s)
    hero = hero_map_id(s)
    cover = {"kind": "map", "id": hero} if hero else None
    if cover is None:
        newest = s.execute(text("SELECT id FROM image ORDER BY rowid DESC LIMIT 1")).scalar_one_or_none()
        cover = {"kind": "image", "id": newest} if newest else None
    return {
        "image_count": data["images"],
        "maps": data["maps"],
        "point_clouds": data["point_clouds"],
        "elevations": data["elevations"],
        "open_findings": open_total,
        "open_top_severity": by_level.get(str(top_level), 0),
        "cover": cover,
    }
```

`backend/app/overview/router.py`:
```python
"""`GET /projects/{projectId}/overview` (spec 2026-09-26-foundation section 9.1)."""

from fastapi import APIRouter, Depends

from app.overview import service
from app.overview.schemas import ProjectOverview
from app.projects.service import ProjectHandle, get_project

router = APIRouter(prefix="/projects/{projectId}", tags=["projects"])


@router.get("/overview", response_model=ProjectOverview)
def get_project_overview(handle: ProjectHandle = Depends(get_project)) -> ProjectOverview:
    return ProjectOverview(**service.build(handle))
```
Include it in `backend/app/api.py` (`from app.overview.router import router as overview_router`,
`overview_router,` in the plain tuple); delete C0's `getProjectOverview` stub and
`EXPECTED_STUBS` entry if Task 1 found them.

`backend/app/projects/schemas.py`: add `from app.overview.schemas import ProjectSummary`, give
`ProjectOut` the field `summary: ProjectSummary | None = None`, and give `from_row` a keyword
`summary: dict | None = None` that it passes on as `summary=ProjectSummary(**summary) if summary else None`.

`backend/app/projects/router.py`: BK's `_out(handle)` builds every `ProjectOut`. Make it fill the
summary:
```python
def _out(handle: ProjectHandle) -> ProjectOut:
    from app.catalogue import service as catalogue_service
    from app.overview.service import project_summary

    top = max(catalogue_service.scale_levels(handle.catalogue))
    with handle.session() as s:
        return ProjectOut.from_row(handle.row(s), handle.folder, summary=project_summary(s, top))
```
(keep whatever else BK's `_out` passes to `from_row`). Then make sure nothing builds a `ProjectOut`
without it:
```powershell
Select-String -Path app\*.py,app\*\*.py -Pattern "ProjectOut\.from_row\("
```
Expected: only `_out`. `update_project` still builds its answer inside its session: move its
`return` after the `with` block as `return _out(handle)`. If C0 declared `summary` required, the
contract test now passes for every project operation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `& $PY -m pytest tests/test_overview.py tests/test_projects.py tests/test_findings_api.py tests/test_contract.py -q -p no:cacheprovider`
Expected: all pass, `test_contract.py` included: no BC operation is unrouted or stubbed any more.

- [ ] **Step 5: Lint and commit**

```powershell
& $PY -m ruff format app tests
& $PY -m ruff check app tests
cd ..
git status --short
git add backend/app/overview/__init__.py backend/app/overview/schemas.py backend/app/overview/service.py backend/app/overview/router.py backend/app/projects/schemas.py backend/app/projects/router.py backend/app/api.py backend/tests/test_overview.py backend/tests/test_contract.py
git commit -m @'
feat(overview): the project Overview endpoint and ProjectOut.summary from pre-aggregated rows

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
```

---

### Task 14: Whole gate, ADR, merge and hand-off

**Files:**
- Create: `vault/decisions/2026-09-26-project-classes-derive-from-project-types.md`
- Test: the whole gate (AGENTS.md item 4)

**Interfaces:**
- Consumes: everything above.
- Produces: `task/f-bc` merged into `main`; the report to the coordinator.

- [ ] **Step 1: Checks that no single test makes**

From `E:\Dev\Yolo\app\.claude\worktrees\f-bc\backend`:
```powershell
Select-String -Path app\*.py,app\*\*.py,tests\*.py -Pattern 'check_removed_classes_unused|/classes"|\.classes = '
Select-String -Path app\db\migrations\versions\*.py -Pattern '^revision = "0010"'
Select-String -Path app\catalogue\migrations\versions\*.py -Pattern '^revision = '
```
Expected: no match for the first; exactly one `0010` file; exactly one catalogue revision,
`"0001"`. Then open `tests/test_contract.py` and confirm that `EXPECTED_STUBS` names none of the
operationIds in the Task 1 table (a stub left there would still pass the contract test). If `main`'s project head moved past `0009` since this branch was cut (a rebase brought in
another revision), set `down_revision` in `0010_foundation.py` to that head and rerun
`tests/test_migration_0010.py`.

- [ ] **Step 2: The ADR**

Create `vault/decisions/2026-09-26-project-classes-derive-from-project-types.md`:
```markdown
---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, database, catalogue, findings]
related: ["[[2026-09-26-foundation-design]]", "[[2026-09-23-counts-live-on-run-rows]]"]
---

# `Project.classes` is derived from `project_type`, and finding numbers use a high-water mark

## Context

The foundation moved class lists from a JSON column on `project` to the app-wide catalogue plus a
per-project `project_type` snapshot. About a dozen backend readers call `handle.row(s).classes`
(boxes, review, maps, analytics, exports, inference). The spec also says a finding number is
`max(number) + 1` and is never reused after a delete, which contradict each other the moment the
newest finding is deleted.

## Decision

- `Project.legacy_classes` maps the old `classes` column (read-only, MG's migration input for one
  release). `Project.classes` is a **property without a setter** that reads `project_type` through
  the row's own session (`app/catalogue/project_types.py::project_classes`). Readers are unchanged; a
  leftover writer raises `AttributeError` instead of silently writing the legacy column. A project
  below `schema_version` 2 with no type rows shows its legacy classes until MG migrates it.
- `project.finding_seq` holds the highest number ever handed out. Allocation runs an `UPDATE` first
  (taking SQLite's write lock), setting it to `max(finding_seq, max(finding.number)) + n`.
- `finding.annotation_id` references `box.id` with **no** `ON DELETE`: a bulk `DELETE FROM box` that
  skips `app/findings/annotations.py` fails loudly instead of leaving findings without geometry and
  counts wrong.

## Consequences

- Code that needs the class list outside a session (a detached row) must read it inside one.
- New code that deletes boxes in bulk must call `annotations.on_images_deleting` (or delete the
  findings itself) first; the foreign key will tell it if it forgets.
- `Project(classes=...)` no longer works in tests; build pre-foundation fixtures with
  `legacy_classes=` or raw SQL.
```

- [ ] **Step 3: Rebase and run the whole gate**

BC merges third in batch 2 (BK → MG-framework → BC → BM). Before rebasing, confirm with
`git log --oneline main` that both BK's and MG-framework's merges are on `main`; if MG-framework is
not, wait for its slot (its backup guard must be on `main` before `0010`).

```powershell
cd E:\Dev\Yolo\app\.claude\worktrees\f-bc
git rebase main
pnpm -C contract check
cd backend
& $PY -m ruff check .
& $PY -m ruff format --check .
& $PY -m pytest -q -p no:cacheprovider
cd ..
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
```
Expected: every command exits 0. BC changes no frontend file, so the frontend steps only confirm
`main` is still green. `pnpm -C frontend e2e` and the conditional `cargo test` run inside
`scripts\finish-task.ps1` in the next step.

- [ ] **Step 4: Commit the ADR and merge**

```powershell
git add vault/decisions/2026-09-26-project-classes-derive-from-project-types.md
git commit -m @'
docs(vault): ADR - Project.classes derives from project_type; finding numbers use a high-water mark

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
'@
scripts\finish-task.ps1
```
Expected: the gate passes, `task/f-bc` merges into `main`, the worktree is removed and the branch
deleted (per `vault/decisions/` worktree-removal rule: links are deleted as links, never `rm -rf`).

- [ ] **Step 5: Operator walkthrough (post with the merge)**

BC is not user-observable yet: the Catalogue screen, the Findings tab and the Overview arrive with
S1 and S2. For the reviewer:
1. `cd backend; & $PY -m pytest tests/test_catalogue_db.py tests/test_catalogue_service.py tests/test_catalogue_api.py -v`: `catalogue.db` next to `library.db`, name matching, hotkeys, the scale, the 503 path.
2. `& $PY -m pytest tests/test_migration_0010.py tests/test_project_types.py -v`: `0010` on a 0009 project, `project.kind` gone, classes from the type list and from the snapshot without a catalogue.
3. `& $PY -m pytest tests/test_findings_service.py tests/test_findings_query.py tests/test_findings_api.py tests/test_findings_files.py -v`: transitions, numbers never reused, filters and paging, the counts property test, comments, photos.
4. `& $PY -m pytest tests/test_findings_invariant.py tests/test_findings_backfill.py tests/test_overview.py -v`: every row of the §8.5 table, the backfill job, and the Overview's fixed statement count.

- [ ] **Step 6: Report to the coordinator**

Send:
- the merged commit range;
- the Task 1 names table as confirmed (every row where C0 differed from this plan);
- the public interfaces from "Public interfaces other units consume", and these hand-offs:
  - **BM**: `resolve_types(cat, type_ids)`, `find_by_names(cat, names)`, `ensure_types(cat, names, kind="object")`, `add_project_types(project_handle, cat, type_ids)` and `normalise_name` are live in `app.catalogue.service`, exactly as BM's `CatalogueAdapter` calls them; swap the stub.
  - **MG-steps**: `open_catalogue_db(data_dir)`; step 1 = `ensure_types(cat, names, origin="migrated", colours=..., hotkeys=...)` + `set_meta(NEEDS_CLASSIFICATION, {"count": n})`; step 3 = `project_types.set_types`; step 6 = `findings_from_annotations(handle, None)` (batched, idempotent on `annotation_id`; the one implementation, MG writes none of its own); step 7 = `counts.recount(s)` + `activity.record`; the migration banner = `app/migration/banners.py`, appended to `BANNER_PROVIDERS` (MG Task 15); `runner.catalogue` is wired here (Task 1), MG only verifies it; `GET/PUT /settings/operator` and `POST /catalogue/classification/done` are built here for S2. New projects start at `schema_version` 2.
  - **M and C**: `service.create_in_session(s, ...)` with `AnchorIn(kind="map"|"cloud", ...)` inside their own transaction; `service.delete_for_anchor(...)` then `trash.move(handle, ids)` when they delete a map or a cloud (no foreign key does it for them).
  - **I**: `POST /findings` takes an image anchor with `box` geometry; the `image_id` filter on `GET /findings` is live; `boxes.create_box_in_session` and `reclass_in_session` exist for polygon work.
  - **S1 and S2**: every endpoint of spec §8.3, §7 and §9.1 is live; "Your name" is `operator_name` in `settings.json`, read and written through `GET/PUT /settings/operator`.
- the ambiguities below.

---

## Spec ambiguities resolved while planning

1. **"Open" on dashboards means not closed** (`open` + `reviewed`). Every migrated and every
   accepted-detection finding is `reviewed`; counting only `open` would hide confirmed defects from
   the Overview's KPIs and severity bars. `by_status` still reports each status separately.
2. **Numbers: `max + 1` versus "never reused".** A high-water mark `project.finding_seq` (added in
   `0010`) makes both true; allocation takes `max(finding_seq, max(number)) + 1`.
3. **Additions to the spec's column lists, all in BC's own revisions:** `catalogue_type.name_key`
   (a partial unique index needs the normalised name stored), `finding_daily.closed_by_severity`
   (KPI 2's "n closed this week" at the top level), `project.finding_seq`, and the index
   `ix_box_class` (the backfill, `class_in_use` and MG's class-id rewrite all filter boxes by class).
4. **Unreviewing or rejecting an accepted defect box deletes its finding** (no confirmation; its
   photos go to the trash). The box stops being ground truth, so it is no longer a finding's
   geometry. Only a reclass to an object type asks for confirmation (the spec's
   `finding_would_be_deleted`).
5. **A ground-truth box reclassed from an object type to a defect type becomes a finding** (the
   §8.5 table is silent; the invariant requires it). A person's box starts `open`, a model's
   `reviewed`.
6. **Accepted detections take the type's default severity**; only the migration and the backfill
   create findings with no severity (D6).
7. **`created_by` for a cloud-provider box** has no library model id: it is `model:<provider>`.
8. **A finding's type that is in the catalogue but not in the project list is added to the list**
   (defect types only, like a run's mapped types in §7.4). An object type is refused before
   anything is written.
9. **`POST /findings` with `annotation_id`** adopts a ground-truth box and reclasses it to the
   finding's type; a pending proposal is refused (`annotation_not_reviewed`), an annotation that
   already has a finding is refused (`annotation_has_finding`).
10. **Deleting a finding through the API also moves its photos to the trash** (the spec names the
    trash only for box deletes; one rule is safer).
11. **Archived types are not refused by the API**; "not offered" is a picker rule, and an existing
    annotation must keep working.
12. **Map and cloud anchors have no foreign key** to `geo_map` / `point_cloud`: deleting a map or a
    cloud is M's and C's code, and they call `delete_for_anchor`. Their `lon`/`lat` come from the
    target's CRS when the caller does not pass them.
13. **The trend** carries the last known open numbers across days without writes; the recount job
    rebuilds `finding_count` and today's `finding_daily` row only (earlier days cannot be rebuilt).
    The day is the operator's local date.
14. **`catalogue.changed`** is published with `project_id: "library"` (the contract's field is a
    non-null string).
15. **The severity scale holds 1–9 levels** (the review keys); shrinking it clears catalogue
    defaults above the new top.
16. **`Project.classes`** becomes a read-only derived property; the legacy column is
    `legacy_classes`. A pre-foundation project with no type rows shows its legacy classes until MG
    migrates it, so the window between BC's and MG's merges shows every old project as before.
17. **New projects start at `schema_version` 2** (nothing to migrate), so MG's startup job skips
    them.
18. **`ProjectOut.summary`** is built by BC (the §9.2 row reads the same pre-aggregated rows as the
    Overview); `ProjectOut.migration` stays MG's.
19. **Comment author**: the Settings "Your name" is stored as `operator_name` in `settings.json`;
    S2 writes it through `PUT /settings/operator` (C0's `putOperatorSettings`, built in Task 10), never
    through localStorage.
20. **The findings counts check on open** (§6.1) compares `SUM(finding_count.n)` with the finding
    row count and queues `findings_recount` when they differ.
21. **What `resolve_types` means.** Spec §18 names it as BM's dependency without a signature. BM's
    plan (already written) calls it with type **ids**, plus `find_by_names`, `ensure_types`,
    `add_project_types` and `service.normalise_name`; MG's calls `open_catalogue_db`. BC provides
    exactly those names, so neither adapter changes.
22. **Summary and Overview shapes** follow S1's plan where the spec is silent:
    `open_by_severity` is `{"<level>": n}`, `by_type` is `[{type_id, n}]`, `latest_volume` carries
    `previous_net_m3` (the client computes the delta), banner tones are `info | warn | danger`. C0's
    contract decides in the end (Task 1 Step 1).

## Spec coverage

| Spec | Task |
| --- | --- |
| §7.1 storage, F1, 503 | 1, 4 |
| §7.2 rules (names, archive, kind change, scale, hotkeys) | 2, 4, 12 |
| §7.3 project type list, snapshots, `ClassDef`, `PUT /types`, `class_in_use` | 5 |
| §7.4 `append_classes` through the catalogue (BM owns the rest) | 5 |
| §8.1 tables, indexes, numbers | 3, 6 |
| §8.2 transitions | 7 |
| §8.3 API | 8, 9, 10 |
| §8.4 counts module and property test | 6, 8 |
| §8.5 invariant, public `create_in_session` | 7, 11 |
| §8.7 deep-link fields (`anchor_kind`, `image_id`, `map_id`, `cloud_id` in every `Finding`) | 9 |
| §9.1 Overview, §9.2 `ProjectSummary` | 13 |
| §10.3 findings group of search | 8, 9 |
| §11.1 revision `0010`; catalogue `0001` | 1, 3 |
| §14 budget | Budget line; 8, 13 |
| §15 error table (BC's rows) | 4, 5, 7, 9, 10, 11, 12 |
| §16 BC's backend tests | every task |
