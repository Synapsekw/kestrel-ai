---
type: moc
status: active
tags: [vault/meta]
---

# Kestrel AI vault — How this works

The Obsidian vault is the **whole Kestrel AI repo** (`.obsidian/` lives at the repo root); this
`vault/` folder holds the **development-memory** layer on top of the codebase: where we are, why we
made each call, and what happened session by session. The codebase tells you _what_ the code is;
this folder tells you _why_ it got that way. Modeled on the Monolith vault.

## Entry point

→ **[[00-north-star]]** — the canonical "where are we, where are we going, why" doc. Open this first.

## Layout

Repo root holds `.obsidian/` (the vault config) and `vault/` (this memory layer). The app's own
`docs/` at repo root is indexed too.

- `vault/00-north-star.md` — the destination + current state (start here)
- `vault/product.md` — product vision, users, design principles
- `vault/moc/` — Maps of Content (thin indexes)
- `vault/decisions/` — ADRs and extracted gotchas (dated)
- `vault/sessions/` — what each working session did (the real "what we did" log)
- `vault/templates/` — note templates (Templater)
- `vault/_attachments/` — pasted images/files
- `docs/` — design docs (indexed via Dataview)

## Maintenance rules

### 1. North-star bump rule

When a phase closes or the current state shifts, update the relevant section in `00-north-star.md`
and bump `last-updated` in its frontmatter.

### 2. Capture a session at the end of each working block

Drop a note in `vault/sessions/` from `vault/templates/session.md`: what changed, why, open threads,
where to pick up next. Filename: `YYYY-MM-DD-HHmm-short-slug.md`.

### 3. Record gotchas as decisions

When you hit a non-obvious trap, write a short ADR in `vault/decisions/` from
`vault/templates/decision.md`. Tag it `gotcha`. This is how we stop re-learning the same lesson.

### 4. Frontmatter-or-die

Every note starts with a YAML frontmatter block at line 1 with at least a `type`:
`session | adr | moc | north-star | product-context | report | spec`.

## Required Obsidian community plugins

The live `dataview` / `dataviewjs` blocks and the `<% tp %>` template syntax need two community
plugins (Settings → Community plugins): **Dataview** and **Templater**. Without them the queries
render as plain code blocks and templates won't expand — everything else still works. Both, plus
Homepage, are vendored in `.obsidian/plugins/` so a fresh clone works without a marketplace fetch.

## Scope note

The vault spans the **whole repo** (`.obsidian/` at the repo root), so the app's `docs/` is indexed
alongside this `vault/` folder. Frontmatter-or-die (rule 4) is what makes those docs show up in the
live Dataview queries.

## Related

- Machine-local Claude auto-memory at `C:\Users\D\.claude\projects\E--Dev-Yolo-app\memory\` — user
  behaviour (how Claude Code should act on this machine), saved outside the repo. This vault is a
  different layer that coexists: project state (what happened, why, what's decided), saved inside
  the repo and shared with anyone who clones it.
