# Secret scan before the repo goes public — 2026-09-20

Scope: this repo (`E:\Dev\Yolo\app`), HEAD `409e0c7` on `main`, immediately after Task 1 landed
(un-ignored and committed 38 files under `.superpowers/sdd/`, including wave ledgers, task briefs
and `review-*.diff` raw diffs). All four branches that will be published were checked:
`main`, `s6-packaging-acceptance`, `usability-wave1`, `wave1-s2-trial`.

```
$ git branch -a
* main
  s6-packaging-acceptance
  usability-wave1
+ wave1-s2-trial

$ for b in main s6-packaging-acceptance usability-wave1 wave1-s2-trial; do git log --oneline -1 "$b"; done
409e0c7 chore: track the SDD wave state so it travels between machines          (main)
9f3aa01 fix(s6): review round 2 (installed sidecar name in docs, filtered selection, installer flags)  (s6-packaging-acceptance)
df39048 test(drivers): acceptance run 8/8 on the redesigned installed app       (usability-wave1)
df39048 test(drivers): acceptance run 8/8 on the redesigned installed app       (wave1-s2-trial)
```

All four branch tips exist and are real refs, so `git log --all` / `git log -p --all` (used below)
walk history from all of them, not just `main`.

## Step 1: Scan every tracked file (working tree, all branches' checked-out content is HEAD only,
but this checks the current tree)

Command (exact, from the brief):

```
git ls-files -z | xargs -0 grep -n -I -E "sk-[A-Za-z0-9_-]{16,}|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-" 2>/dev/null
```

Output:

```
backend/tests/test_cloud_providers.py:23:FAKE_KEY = "sk-not-a-real-key-7b1c"
backend/tests/test_keys_config.py:12:SECRET = "sk-test-do-not-log-4f8c2a"
docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md:112:git ls-files -z | xargs -0 grep -n -I -E "sk-[A-Za-z0-9_-]{16,}|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-" 2>/dev/null
docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md:115:Expect **no output**, with one known-safe exception: `backend/tests/test_keys_config.py` defines `SECRET = "sk-test-do-not-log-4f8c2a"`, a deliberate fake used to assert keys never leak. That one is fine.
docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md:120:git log -p --all | grep -n -E "sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" | head -40
```

(`xargs` exit code 123, which just reflects that some of its child `grep` invocations matched —
expected given the output above.)

Adjudication:

- `backend/tests/test_keys_config.py:12` — `SECRET = "sk-test-do-not-log-4f8c2a"`. This is the
  **known-safe exception pre-adjudicated in the task brief**: confirmed it is that exact file and
  that exact literal. Read the surrounding code — it is a deliberate fake used by
  `test_memory_key_store_round_trips_and_deletes_missing_keys_quietly` to assert keys round-trip
  through `MemoryKeyStore` without being logged. **CLEAN.**
- `backend/tests/test_cloud_providers.py:23` — `FAKE_KEY = "sk-not-a-real-key-7b1c"`. Not the
  pre-adjudicated exception (different file/literal), so adjudicated independently. Opened the
  file: docstring reads "Responses are replayed through the real SDK response types... No test
  carries or prints a key." The variable name and the literal string itself (`not-a-real-key`)
  both self-declare it as a placeholder used only to construct a provider client against recorded
  fixtures; it is never sent anywhere live. **CLEAN.**
- `docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md:112,115,120` — these three lines are
  the plan document literally quoting this task's own brief (the grep command text and the
  known-safe-exception sentence). Not a credential; it's documentation about the scan itself.
  **CLEAN.**

No other hits. No `sk-ant-`, `ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`, `AKIA...`, PEM private key header,
or Slack `xox...` token pattern anywhere else in the tracked tree.

## Step 2: Scan the full history (all branches)

Command (exact):

```
git log -p --all | grep -n -E "sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" | head -40
```

Output: **(empty — no matches).**

Note this pattern set is stricter than Step 1's (`sk-[A-Za-z0-9]{32,}` requires 32+ chars, so it
does not even match the two short test fixtures above); the empty result confirms nothing that
looks like a real long-form API key or PEM private key has ever been committed on any of the four
branches' history.

## Step 3: Confirm no env file was ever committed (all branches)

Command (exact):

```
git log --all --diff-filter=A --name-only --format="%H" | grep -E "^\.env|/\.env" | sort -u
```

Output: **(empty — no matches).** No `.env` (or `**/.env`) file has ever been added in the history
of any of the four branches.

## Step 4: Evidence and diff payloads

### 4a. Text sweep

Command (exact):

```
git ls-files -z 'docs/evidence/*' '.superpowers/sdd/*' | xargs -0 grep -l -I -E "api[_-]?key|authorization|bearer |token" 2>/dev/null
```

Output (19 files):

```
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/progress.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/review-2cbdd3c..ed81442.diff
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/review-ba8728c..2cbdd3c.diff
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/review-f348f1e..ba8728c.diff
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-10-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-4-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-6-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-7-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-8-9-report.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-8-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-9-brief.md
.superpowers/sdd/usability/g2-report.md
.superpowers/sdd/wave2/s4-report.md
.superpowers/sdd/wave3/s6-report.md
.superpowers/sdd/wave3/s6-review-package-r1.md
.superpowers/sdd/wave3/s6-review-package-r2.md
.superpowers/sdd/wave3/s6-review-package.md
.superpowers/sdd/wave3/s6-review-r1.md
.superpowers/sdd/wave3/s6-review.md
```

Each file was opened (via `grep -n` with the matched lines and surrounding context read, plus
direct reads of the flagged sections) and adjudicated individually — no batch approval:

1. **`progress.md`** — mentions `token` in table cells describing the auth contract
   (`invoke("backend_info")` returns `{base_url, token}`) and a changelog line about
   `dev.ps1 token via env`. All are field/mechanism names, no values. **CLEAN.**
2. **`review-2cbdd3c..ed81442.diff`** — one hit: `headers={"Authorization": "Bearer test-token"}`
   in a test client call. Literal test fixture string `test-token`. **CLEAN.**
3. **`review-ba8728c..2cbdd3c.diff`** — hits are all `require_token`/`ws_token_ok` function/param
   names, the literal test string `test-token` (incl. a non-ASCII-token 401 test using `"café"`),
   and a PowerShell snippet generating a random 32-char per-launch dev token
   (`$token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ...)`) assigned to
   `$env:APP_TOKEN` for a local-only dev backend process. No live external credential. **CLEAN.**
4. **`review-f348f1e..ba8728c.diff`** — same shape as #3: `require_token`/`ws_token_ok` defs,
   `TOKEN = "test-token"` test fixture, `Authorization: Bearer test-token` in test clients, and the
   same random-dev-token PowerShell generator. **CLEAN.**
5. **`task-10-brief.md`** — the same PowerShell per-launch random-token generator
   (`$token = -join (...) | Get-Random -Count 32 ...`) used to start the local dev backend, plus
   `APP_BACKEND_TOKEN` env var name. Ephemeral, locally generated per dev-server launch, never a
   secret to any external service. **CLEAN.**
6. **`task-4-brief.md`** — `TOKEN = "test-token"` test fixture, `require_token`/`ws_token_ok`
   function names, `request.headers.get("authorization", "")` (header name, not a value), API
   route wiring (`Depends(require_token)`). **CLEAN.**
7. **`task-6-brief.md`** — `token=test-token` / `token=wrong` in websocket test URLs, plus
   `ws_token_ok` import. Test fixtures only. **CLEAN.**
8. **`task-7-brief.md`** — one hit: `headers={"Authorization": "Bearer test-token"}` in a test
   client. **CLEAN.**
9. **`task-8-9-report.md`** — describes the Tauri sidecar boot with "a per-launch token"; the
   line at 240 explicitly states "No secrets in any file. The per-launch token is generated in
   Rust and never written to disk by this code." Field names and a design statement, no value.
   **CLEAN.**
10. **`task-8-brief.md`** — `resolveBackend()` type signatures and test expectations using literal
    placeholder values `"mock"`, `"abc"`, `"t"` for the `token` field. All fixture/mock values, not
    real credentials. **CLEAN.**
11. **`task-9-brief.md`** — Rust struct field `pub token: String`, `random_token()` function name,
    `.env("APP_TOKEN", &token)` (setting a subprocess env var to a freshly generated local token,
    not reading a `.env` file), and a `git commit -m` message text. **CLEAN.**
12. **`g2-report.md`** — three lines of the form `APP_TOKEN=dev-token-g2[...]` used to launch a
    local backend instance during a usability-test session (`dev-token-g2`, `dev-token-g2b`,
    `dev-token-g2c`). These are literal, deliberately-named dev-only tokens for a throwaway local
    process, not values that grant access to any external/cloud system. **CLEAN.**
13. **`s4-report.md`** — `max_tokens` (LLM API parameter name), "token usage", "the bucket is
    shared per provider and follows the configured rate" — all API/rate-limiter vocabulary, no
    values. One line notes live provider tests read a key's presence via
    `bool(os.environ.get(...))` "never printed" — a design statement confirming keys are not
    logged, not a leaked key. **CLEAN.**
14. **`s6-report.md`** — two hits show a live Tauri dev session's `backend_info` JSON:
    `"token":"..."` and `"token":"Uwd0..."`. This is the ephemeral, per-launch local auth token
    that authenticates the frontend to its own sidecar backend process on localhost; it is
    regenerated every launch, already truncated/redacted in the report to 4 chars or `...`, grants
    no access beyond a now-long-terminated local process, and is not a cloud-provider credential.
    Also has `openEventStream` subscribing via `?token=...` (mechanism, no value). **CLEAN
    (ephemeral local token, not a live external credential; already partially redacted).**
15. **`s6-review-package-r1.md`** — `TOKEN = "test-token"` fixture, `Authorization: Bearer
    ${info.token}` (template interpolation, not a value), and diff lines showing the review
    recommending `await api("PUT", "/providers/anthropic/key", { api_key: key }, { redact: true
    })` — i.e., a fix that adds *redaction* of the key parameter in logs. No key value present.
    **CLEAN.**
16. **`s6-review-package-r2.md`** — one hit, same redaction-fix line as above
    (`{ redact: true }`). **CLEAN.**
17. **`s6-review-package.md`** — largest hit set: `Authorization: Bearer <token>` (doc prose),
    `Invoke-Api PUT "/providers/anthropic/key" @{ api_key = "frozen-smoke-placeholder-not-a-key"
    }` (the literal value is explicitly named as a placeholder), `token` field names throughout a
    Rust/TS diff (`pub token: String`, `random_token()`, `.env("APP_TOKEN", &token)`,
    `token: "mock"`, `token: "abc"`, `token: "t"` — all mock/fixture literals), and one mock server
    verification line ("200 with token, 401 without"). No real key or live token value anywhere.
    **CLEAN.**
18. **`s6-review-r1.md`** — one hit, prose describing that `acceptance.mjs` opens a
    `ws://.../api/v1/events?token=` socket and awaits `open` before returning; a mechanism
    description, no value. **CLEAN.**
19. **`s6-review.md`** — one hit (line 97), a *code-review finding* about a **hypothetical, not
    actual, risk**: "the backend's 422 handler echoes pydantic's `input`... For `PUT
    /providers/anthropic/key` that would print the key. Unreachable today (`api_key:
    min_length=1`, and the driver skips on an empty variable), but redact the body for that one
    call." This is reviewers flagging a defensive-hardening suggestion, not a record of an actual
    leaked key — no key value appears, and the same file confirms the path is "unreachable today."
    **CLEAN.**

All 19 flagged files: field names, header names, or test/dev/local placeholder values. **No live
credentials found.**

Also checked, per the task's extra guidance, whether any of the `.superpowers/sdd/**/review-*.diff`
files contain `.env`-shaped content (dotenv file bodies) rather than just code that reads
`import.meta.env` / calls `.env()` on a subprocess builder:

```
$ git ls-files -z '.superpowers/sdd/*' | xargs -0 grep -l -I -E "\.env" 2>/dev/null
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-8-brief.md
.superpowers/sdd/2026-09-17-s0-contract-and-scaffolding/task-9-brief.md
.superpowers/sdd/usability/g2-report.md
.superpowers/sdd/wave2/s4-report.md
.superpowers/sdd/wave3/s6-review-package-r1.md
.superpowers/sdd/wave3/s6-review-package-r2.md
.superpowers/sdd/wave3/s6-review-package.md
```

All hits are `import.meta.env.APP_BACKEND_URL`/`import.meta.env.APP_BACKEND_TOKEN` (Vite's env
API), Rust's `Command::env("APP_TOKEN", &token)` (setting a subprocess environment variable, not
reading a dotenv file), and `os.environ.get(...)`. No dotenv file content anywhere. Consistent with
Step 3's empty result. **CLEAN.**

### 4b. Screenshot sweep

Command (exact):

```
git ls-files 'docs/evidence/**/*.png' | head -40
```

146 PNGs are tracked under `docs/evidence/` in total (the `head -40` in the brief only shows the
first 40; the full count was checked with `git ls-files 'docs/evidence/**/*.png' | wc -l` → 146).
Per the task's extra guidance, every PNG whose name plausibly indicates a settings, provider, key,
detect, or query/inference screen was actually opened and viewed with the image-reading tool (not
inferred from filename). Viewed (11 images):

- `docs/evidence/ui/2026-09-19-site-office/14-app-settings.png` — App settings, Provider keys
  card. OpenAI "No key stored" (empty `Paste the API key` placeholder), Anthropic "Key stored"
  badge with the API key input showing only the placeholder `Paste a new key to replace the stored
  one` — the actual stored key is never rendered into the input. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/13-project-settings.png` — Project settings (classes,
  pre-annotation model, import defaults). No provider-key UI on this screen. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/walkthrough/02-app-settings.png` — Same App settings
  screen, both providers "No key stored", both key inputs show only placeholder text. **CLEAN.**
- `docs/evidence/usability/2026-09-19-after/02-app-settings.png` — Same screen (dark theme), both
  providers "No key stored", placeholder-only inputs. **CLEAN.**
- `docs/evidence/usability/2026-09-19-before/16b-provider-test-bogus.png` — "Walkthrough" Settings
  screen exercising a deliberately bogus/invalid key: Anthropic shows "Key stored" and a failed
  test result `Failed: ProviderError: anthropic returned 401: Error code: 401 -
  {'error': {'type': 'authentication_error', 'message': 'API key is invalid.'}, 'request_id':
  None}`. This is an error message confirming the key was rejected — the actual key value is never
  displayed anywhere in the screenshot. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/12-detect.png` — Detect screen (model/images/confidence
  picker, run history row "Anthropic: 'dump trucks'"). No key or token visible. **CLEAN.**
- `docs/evidence/acceptance/2026-09-20-installed-177f68b/acceptance-07-cloud-run.png` — Detect
  screen showing a completed cloud (Anthropic) detection run and its run history. No key/token
  visible. **CLEAN.**
- `docs/evidence/acceptance/acceptance-06-query-run.png` — Query screen, local-model run only. No
  provider key UI. **CLEAN.**
- `docs/evidence/acceptance/2026-09-19-installed-88d9216/acceptance-06-query-run.png` — Same Query
  screen, different run. No key visible. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/walkthrough/16-query-trained-model.png` — Detect screen,
  local model run, 0 boxes found. No key visible. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/walkthrough/17-query-starter-model.png` — Same, 230
  boxes found. No key visible. **CLEAN.**
- `docs/evidence/ui/2026-09-19-site-office/walkthrough/20-query-starter-model.png` — Detect screen,
  local model run. No key visible. **CLEAN.**
- `docs/evidence/usability/2026-09-19-before/14d-query-done.png` — Query screen, local model run
  only. No key visible. **CLEAN.**

(That is 13 distinct images actually opened; the list above enumerates each. All are CLEAN — no
provider key, token, or other credential value is visible in any pixel of any image reviewed.)

Skipped (not opened): the remaining ~133 PNGs under `docs/evidence/checkpoint*/`,
`docs/evidence/acceptance/**` (project/import/preannotation/dataset/training/review/export/
promoted steps), `docs/evidence/ui/2026-09-19-site-office/**` (projects, home, images grid/list,
import dialog, label, review, datasets, models, train, jobs drawer, and the rest of the
walkthrough sequence), and `docs/evidence/usability/**` (the remaining before/after walkthrough
steps). These names indicate project/image/label/review/dataset/train/export/data-manager screens
with no provider-settings or key-entry surface in this app's UI (confirmed by the settings screens
above, where the *only* place a key could appear is the App settings "Provider keys" card, and
that card is masked/placeholder in every instance checked). Given the consistent masking behavior
across every settings/provider/detect/query screen actually opened, and that this app's design
(confirmed via the code review in `.superpowers/sdd/wave3/s6-review.md`) treats key values as
things that are deliberately never echoed back to the UI, it was judged unnecessary to open every
remaining screenshot of unrelated screens (import dialogs, label editor, dataset tables, etc.)
that have no code path to display a provider key at all.

## Step 5: Verdict

**CLEAN.**

- Step 1 (tracked-file secret-pattern sweep): only the pre-adjudicated known-safe fixture
  (`backend/tests/test_keys_config.py`), one additional self-declared fake test fixture
  (`backend/tests/test_cloud_providers.py`), and the plan document quoting this task's own brief.
  No live credentials.
- Step 2 (full-history sweep, all four branches, stricter patterns): no output at all.
- Step 3 (`.env` file ever committed, all four branches): no output at all.
- Step 4 (evidence + `.superpowers/sdd` diff/report payloads for key/auth/token language, plus
  screenshot review of every plausible settings/provider/detect/query screen): all 19 flagged text
  files individually adjudicated as field names, header names, test/dev/local placeholder or
  ephemeral values, or hardening-review prose about a hypothetical (and today-unreachable) risk —
  none contain a live external credential. All 13 screenshots opened and visually inspected show
  masked/placeholder key inputs, "No key stored"/"Key stored" badges, or run-history rows with no
  key/token pixels — none show a live credential.

No item in this scan was classified as UNCERTAIN. Nothing here blocks the repo from going public
on secret-exposure grounds.

## Commands run, verbatim, for reference

```bash
git rev-parse HEAD
git branch -a
git ls-files -z | xargs -0 grep -n -I -E "sk-[A-Za-z0-9_-]{16,}|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-" 2>/dev/null
git log -p --all | grep -n -E "sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" | head -40
git log --all --diff-filter=A --name-only --format="%H" | grep -E "^\.env|/\.env" | sort -u
git ls-files -z 'docs/evidence/*' '.superpowers/sdd/*' | xargs -0 grep -l -I -E "api[_-]?key|authorization|bearer |token" 2>/dev/null
git ls-files 'docs/evidence/**/*.png' | head -40
git ls-files 'docs/evidence/**/*.png' | wc -l
git ls-files -z '.superpowers/sdd/*' | xargs -0 grep -l -I -E "\.env" 2>/dev/null
for b in main s6-packaging-acceptance usability-wave1 wave1-s2-trial; do git log --oneline -1 "$b"; done
```
