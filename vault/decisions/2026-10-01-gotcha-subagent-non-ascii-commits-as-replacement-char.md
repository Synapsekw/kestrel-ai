---
type: adr
date: 2026-10-01
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-01-1842-overview-landing]]", "[[2026-09-19-gotcha-bash-heredoc-collapses-backslashes]]"]
---

# Gotcha: a subagent can commit a non-ASCII character as U+FFFD, and the tests stay green

## Context

In the Overview v2 build, one implementer subagent wrote `CloudStaticCard.tsx` with the separator
`" · "` (U+00B7). The committed bytes were `EF BF BD`: U+FFFD, the replacement character. The task
brief and the plan held the correct character, and `grep $'\xEF\xBF\xBD'` over them found nothing.
The corruption came in when the file was written. The card would have rendered "3.2 M points � 2026-…".
Lint, the build and the unit tests all passed, because nothing asserted that meta line. The per-task
reviewer caught it by running `od -c` on the diff's odd glyph.

Separately, a Windows console print of a correct UTF-8 file (`4×2` in the spec) also showed `�`. That
was only the console's display, and the bytes on disk were fine.

## Decision

- Before merging a subagent's frontend work, run `git grep -c $'\xEF\xBF\xBD' -- frontend/src`. It
  should return no hits.
- Any user-visible string that contains a non-ASCII character (`·`, `°`, `≈`, `→`, `×`) gets at least
  one test assertion on the rendered text.
- Implementers write non-ASCII text with the Edit/Write tools, not through a shell heredoc.

## Rationale

The defect is invisible to the type checker, the linter and most tests, and it only shows on
screen. A byte-level grep is cheap and exact. Trusting a console print is not enough, because the
console misrenders correct files too. Check the bytes with `od -c` or a grep, not the terminal.

## Consequences

- Positive: a single grep catches the whole class of bug before merge.
- Negative: one more step in the merge checklist.
- Open follow-ups: consider adding the grep to `frontend lint` (in `scripts/check-tokens.mjs` or a
  sibling script) so it is enforced rather than remembered.

## Related

- [[2026-10-01-1842-overview-landing]]
- [[2026-09-19-gotcha-bash-heredoc-collapses-backslashes]]
