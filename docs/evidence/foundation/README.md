# Foundation unit X evidence

The cross-unit journey is `frontend/e2e/foundation-journey.spec.ts`: one project goes from New
project through Add data (photos), the project's type list, an accepted Crack detection that becomes
finding F-0001, its severity set in the Findings tab's inspector, the Findings row and the Overview
severity bar, a dataset built in Models, to the training form starting a run on that dataset. Its
routes are a small stateful backend, so every step reads what the step before it wrote.

## Reads per finding edit

Measured 2026-09-27 on `task/f-x` (parent `main` 7477e3c plus the F-X index tasks), in the journey's
step 5: the finding is open in the Findings tab's inspector (`/p/{projectId}/findings/{findingId}`),
the page is let settle, and the severity is changed from 2 Moderate to 3 Major with a click (one
`PATCH /projects/{projectId}/findings/{findingId}` with `{"severity": 3}`). Counted: every GET the
app sent to the API from that click until nothing was in flight and nothing started for 1.5 s.

**5 reads**, the same list in every run (3 isolated runs and the full suite):

| # | Request (ids replaced by names) | Who reads it |
| --- | --- | --- |
| 1 | `GET /projects/{projectId}/overview` | the project tab counts (`useProjectCounts`) |
| 2 | `GET /projects/{projectId}/activity?subject_id={findingId}&limit=20` | the inspector's History |
| 3 | `GET /projects/{projectId}/findings/{findingId}` | the inspector's detail (`useFinding`) |
| 4 | `GET /projects/{projectId}/findings/summary` | the Findings filter counts (`useFindingSummary`) |
| 5 | `GET /projects/{projectId}/findings?sort=-severity&limit=200` | the Findings list, re-read (`useFindingsList`) |

All five come from one `bumpFindings()` after the PATCH answers: each hook keyed on
`findingsRevision` re-reads once (the list after its 300 ms debounce). Every read is bounded (a
detail, a summary, a limit of 20 or 200).

**The mock has no events socket.** This counts the client's own re-reads after its write only. In
the app the backend also publishes `findings.changed` for the same write (`app/findings/events.py`,
after commit); that bumps `findingsRevision` again, so the same five reads can follow a second time,
up to 10 in all when the event lands after the first re-reads (S1's estimate was about 9). The
detail read (#3) repeats what the PATCH's answer already carried.

The spec guards the number with `expect(reads.length).toBeLessThanOrEqual(5)` and attaches the list
to the test result as `reads-per-finding-edit.txt`.
