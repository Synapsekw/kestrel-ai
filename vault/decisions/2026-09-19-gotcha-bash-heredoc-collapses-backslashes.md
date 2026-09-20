---
type: adr
date: 2026-09-19
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: Bash heredocs collapse backslashes

## Context

Windows paths use `\` as the separator, and some content (PowerShell one-liners, path strings)
needs a literal `\\`. Writing such content through a Bash heredoc on this machine silently turns
`\\` into `\`.

## Decision

Never write Windows paths or double-backslash content through a Bash heredoc. Use the Write or
Edit tools instead, or `chr(92)` if backslashes must be constructed programmatically.

## Rationale

The heredoc's collapse is silent — the write succeeds, and the corruption only surfaces later
when the path fails to resolve. Tools that write file content directly (Write/Edit) don't pass
through this transformation.

## Consequences

- Positive: Windows paths and escaped backslashes survive intact in every file written this way.
- Negative: one more thing to remember when scripting file writes on this machine.
- Open follow-ups: none.

## Related

-
