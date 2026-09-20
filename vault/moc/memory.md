---
type: moc
status: active
tags: [moc, memory]
---

# Memory map

How Kestrel AI's memory is layered, modelled on Monolith's vault.

## Layers

1. **This vault** (`vault/`) — project state: north star, product context, decisions, sessions.
   Shared with anyone who clones the repo. Start at [[00-north-star]].
2. **`.superpowers/sdd/`** — per-plan SDD workspaces (progress ledgers, sub-agent reports).
   **Tracked**, so it travels between machines (spec §2's decision table). The superpowers tooling
   regenerates a `.gitignore` containing `*` inside this directory on every run, which is harmless
   for files already tracked but means a **new** wave needs `git add -f` — see `CONTRIBUTING.md`'s
   note under "Dev memory".
3. **Machine-local Claude auto-memory** — `C:\Users\D\.claude\projects\E--Dev-Yolo-app\memory\` —
   user behaviour (how Claude Code should act on this machine), saved outside the repo, not shared.

## Gotcha decisions

```dataview
TABLE status, file.cday as "Recorded"
FROM "vault/decisions"
WHERE contains(tags, "gotcha")
SORT file.cday DESC
```

See `vault/decisions/` for the full set; this table filters to the ones tagged `gotcha`.

## Related

- [[00-north-star]]
- [[operations]]
