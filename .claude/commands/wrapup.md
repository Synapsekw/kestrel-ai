# /wrapup

Log this working block to the dev-memory vault at `vault/` and bump the vault's homepage. Run this
at the end of a working block, before the operator walks away.

**This is a checklist for you, the agent, to execute by hand — read files, look at real `git`
output, and write real Markdown. Do not write or run a script that tries to generate the note
mechanically; the point of this command is your judgment about what actually happened.**

## The one rule that overrides everything below

**Do not invent progress.** Every claim in the session note must trace back to something you can
point at: a commit, a diff, a file you edited, a test you ran and saw the output of. If this
working block shipped nothing — no commits, no code, a dead end, an aborted experiment — the note
says exactly that, in as many words: "nothing shipped this block" plus why. A session log that
quietly inflates what happened is worse than no log at all, because every later session trusts this
vault as ground truth. When in doubt, under-claim and let the "Open threads" section carry the
honesty.

## Steps

### 1. Determine what actually changed

Run, and read the real output before writing anything:

```
git log --oneline main@{1}..main
git diff --stat
git status
```

If this session worked in a worktree or on a branch other than `main`, adjust the range
accordingly (e.g. `git log --oneline <base>..HEAD`) so it captures this working block's commits,
not unrelated history. If neither command shows anything, that is itself the finding — see the
rule above.

### 2. Write the session note

Copy `vault/templates/session.md` to `vault/sessions/YYYY-MM-DD-HHmm-<short-slug>.md` (use the
current date/time for the filename and a short kebab-case slug describing the block, e.g.
`2026-09-20-1530-wrapup-command`). `vault/sessions/` already exists (currently holds only
`.gitkeep`).

Fill in the template's frontmatter:

- `type: session`
- `date: <today, YYYY-MM-DD-HHmm or YYYY-MM-DD>`
- `branch: <current git branch, from` `git branch --show-current` `>`
- `trigger: wrapup`
- `status: complete`
- `tags: [session]`
- `related: []` (or fill in `[[wikilinks]]` to ADRs/notes touched this block, if any)

Fill in the template's sections, using the **real heading names from
`vault/templates/session.md`**:

- **What changed** — files touched, commits made (with short SHAs), key decisions. Pull this
  straight from the `git log`/`git diff --stat` output in step 1. Do not describe work that isn't
  in that output.
- **Why** — 1–3 sentences: the part `git log` can't tell you (motivation, what problem this
  solved). If there's nothing shipped, explain why the block didn't land anything instead.
- **Open threads** — anything left unfinished, blockers, follow-ups. Be specific enough that a
  cold read six weeks from now knows where things stand.
- **How to test** — numbered operator steps: where to go, what to click or run, expected result.
  This mirrors the working-agreement rule in `AGENTS.md`/`CONTRIBUTING.md` that no task is done
  without a "how to test this" walkthrough. If the change genuinely has no user-observable effect
  (e.g. this command file, an internal refactor with no behavior change), write exactly one line
  saying so and why — never leave this section blank, and never pad it with steps that don't
  actually exercise anything.
- **Next session entry point** — where to start when picking this back up.

### 3. Update the north star

Open `vault/00-north-star.md` and update it in place — do not replace whole sections wholesale,
edit them to reflect reality:

- **`## 4. Now`** — update the **Shipped last**, **In flight**, and **Next** lines to reflect this
  block's actual outcome. If nothing shipped, `Shipped last` should still say so plainly rather
  than repeating stale news as if it were current.
- **`## 5. Owed`** — add, update, or close out entries for anything this block surfaced as owed
  (a stale check, a deferred fix, a known gap). Don't remove an owed item unless you have evidence
  it was actually resolved this block.
- **`## 3. Phases`** table — update the relevant row's **Status**/**Outcome** cell if this block
  changed a phase's state (e.g. moved something from "in flight" to "merged", or a checkpoint from
  pending to passed). Leave rows alone that this block didn't touch.
- Frontmatter — bump `last-updated:` (currently `last-updated: 2026-09-20` — set it to today's
  date, `YYYY-MM-DD`) at the top of the file.

Only change what this block's real evidence supports. Leave everything else in the file untouched.

### 4. Optional: log a gotcha ADR

If this block hit a non-obvious trap — something that cost real time, would bite someone else the
same way, or contradicts what you'd naively expect — write an ADR:

- Copy `vault/templates/decision.md` to
  `vault/decisions/YYYY-MM-DD-gotcha-<short-slug>.md` (see existing examples in `vault/decisions/`,
  e.g. `2026-09-19-gotcha-bash-heredoc-collapses-backslashes.md`, for the house style).
- Frontmatter: `type: adr`, `date`, `status: accepted` (or `proposed` if still under debate),
  `tags: [decision, gotcha]`, `related: []`.
- Fill **Context**, **Decision**, **Rationale**, **Consequences** (Positive/Negative/Open
  follow-ups), **Related** — the real headings in `vault/templates/decision.md`.

Skip this step entirely if nothing this block qualifies as a gotcha. Don't manufacture one to fill
the slot.

### 5. Commit

Stage only the vault (and the ADR, if you wrote one) — never stage unrelated working-tree changes:

```
git add vault/
git commit -m "docs: wrapup <slug>"
```

Use the same `<short-slug>` as the session note's filename. Before committing, run `git status` and
confirm everything staged is vault content from this command — nothing from `backend/`,
`frontend/`, `contract/`, or elsewhere leaked in.

## If you're not sure what to write

Re-read step 1's `git` output rather than guessing. If the evidence is genuinely ambiguous (e.g.
unclear whether a change was intentional or finished), say so in **Open threads** rather than
picking a confident-sounding story. The vault is only useful if the next session can trust it
completely.
