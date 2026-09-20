# Wave 2 ledger (S4, S5)

Checkpoint 2 passed on main 9b4941f (2026-09-18). S4 implementer dispatched (opus) in .worktrees/s4-inference-providers at 9b4941f. S5 plan being written (fable).
S5 plan complete (fable, 21 tasks, 7934 lines; a mid-way snapshot had been committed in de07f6a, full version a0322d5). S5 implementer dispatched (opus) in .worktrees/s5-training-inference-ui at a0322d5; node modules installed, 109 unit tests green at start.
S4 implementer (opus): DONE_WITH_CONCERNS, 10 commits 9b4941f..9552ce4; 356 tests, gpu 4 passed, live 5 skipped (no keys). Contract edit for S4 gap (2d54e9f): QueryRunCreate.query minLength 1.
  Ruling: tile persistence keyed on query_run_id (runs/query-runs/<run_id>/tiles) so a re-created run cannot resume but a restarted job on the same run does; no resume endpoint added (contract unchanged). Cost if wrong: repeated tiles on re-run.
  Ruling: live cloud calls remain unverified until an API key is available; the acceptance run (step 7) needs ANTHROPIC_API_KEY set in the environment by the operator; recorded in docs/progress.md as an open item.
S4 review dispatched (fable); goal owner re-running full suite, gpu and ruff in the S4 worktree.
S5 implementer (opus): DONE, 21 commits a0322d5..f44c3ee; 189 unit, 41 e2e (claimed). Review dispatched (fable); goal owner re-running suites. S4 goal-owner verification: 356 passed, gpu 4, ruff clean.
S4 review (fable): spec ✅ (one plan-mandated geometry defect); Important: tiles overshoot the image when one side <= tile_size; uncancellable waits (uncapped retry_after sleep, gpu_lock behind training, sync pre-annotate hangs the request thread); pre-annotate double-write race.
  Ruling: added POST /query-runs/{runId}/resume to the contract (2e8592a) so spec 8 "resumable" is real; tiles persisted per run; resume keeps reviewed boxes. Cost if wrong: one more endpoint to support in S5 (a Resume button on the run card; add in S5's fix round). Ruling: pre-annotate answers 409 "GPU busy" instead of waiting behind training. Cost if wrong: UI shows no proposals while training runs.
S4 fix round 1/5 dispatched (1-4 + minors A-E + keyring backend pin).
  Deferred minors: config.update read-modify-write without lock; untiled local runs predict at tile_size (1280) vs pre-annotation 2560 (UI note or separate imgsz later); keyring backend pin also needed in S6 packaging.
S5 review (fable): spec ✅, Approved with 2 Important (useTrackedJob polls a 404 forever + log spam; RunCard replaced by alert on transient poll error). Goal-owner verification: 189 unit, 41 e2e, lint/build clean.
S5 fix round 1/5 dispatched (1, 2, Resume button for the new endpoint, minors 3,4,6,8,9,10; contract edits mirrored + client regenerated in the worktree).
  Deferred minors: TrainForm native validation vs validateTrainForm (noValidate), applyEvent ignores payload finished_at, "Showing N images" counts URL ids, per-card 1 s timers, useTrackedJob finished-job test only covers the initial tick.
S5 fix round 1/5 (f44c3ee..b1acfc8): implementer claims all fixed + Resume button; 199 unit, 42 e2e. Re-review dispatched (opus); goal owner re-running suites.
S5 fix round 1 re-review (opus): 8 not addressed (refresh fires at queue time), new Important: give-up permanent; stale failure never cleared. Round 2/5 dispatched (8, give-up recovery via store events + Retry, clear failure, toTiling defaults when disabled, focus restore, giveUp cancelled flag, trackJob race, failed re-list keeps list).
  Deferred minors (S5): e2e jobs.spec matches any count; pollers do not await in-flight ticks (overlapping requests); ModelTable rows not keyboard-focusable.
S4 fix round 1/5 (9552ce4..a6aea52): implementer DONE, 380 tests, gpu 4; re-review dispatched (opus); goal owner re-running suite/gpu/ruff.
  Note for S5/S6: pre-annotate may answer 409 "GPU busy" during local query runs/training; the UI treats 409 as "busy, retry later" (S5 fix round if not already tolerant).
S4 round 1 re-review (opus): 10/10 addressed; new Important: all-cached skip can strand an image boxless after a hard kill; resume duplicates reviewed proposals. Round 2/5 dispatched (C1, C2, minors M1-M5).
  Deferred: no cleanup of runs/ tile caches (orphaned old-layout folders); unreview re-exposes a box to proposal deletes; keyring pin per instance re-sets the global backend.
S5 fix round 2/5 (b1acfc8..1bcd89a): implementer claims all fixed (204 unit, 42 e2e). Re-review dispatched (sonnet); goal owner re-running suites.
S5 round 2 re-review (sonnet): all addressed, no new breakage. S5 complete (a0322d5..1bcd89a). Merged to main 04a879f (no conflicts; contract identical). main frontend: 204 unit, 42 e2e, build, lint clean.
Note: main's backend contract test transiently fails (resumeQueryRun routed nowhere) until S4 merges; expected.
S4 round 2 implementer was terminated by a usage limit mid-implementation (uncommitted partial changes in the worktree); resumed with instructions to continue from the uncommitted state.
S4 fix round 2/5 (a6aea52..a8110f1): implementer DONE, 382 tests; re-review dispatched (opus); goal owner re-running suite/gpu/ruff. M4 partial (JobCancelled relocation needs runner.py: goal-owner follow-up after merge).
S4 round 2 re-review (opus): all addressed, no new Important. S4 complete (9b4941f..a8110f1). Merged to main 6635f71 (no conflicts). main: 382 backend tests, contract check, ruff clean; GPU tests running.
  Deferred minors (S4 round 2): progress message counts only inserted boxes; images with genuinely empty detections take the rewrite branch on resume; set_rate fast path inside the lock (contention only); _reviewed untyped param; class-changed reviewed boxes suppress only the new class; deleted proposals are re-proposed on resume; submit-then-set_job window in resume (pre-existing shape); plan doc stale on the infer result shape.
  Follow-up for the goal owner: move JobCancelled to app/jobs/cancellation.py and re-export from runner.py (S4 M4).
