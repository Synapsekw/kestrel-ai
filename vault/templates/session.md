---
type: session
date: <% tp.date.now("YYYY-MM-DD-HHmm") %>
branch: <% tp.user.git_branch() %>
trigger: wrapup
status: complete
tags: [session]
related: []
---

# <% tp.file.title %>

## What changed

- (files touched, commits made, key decisions)

## Why

- (1–3 sentences — the part git log can't tell you)

## Open threads

- (anything left unfinished, blockers, follow-ups)

## How to test

- (numbered steps for the operator: where to go, what to click, expected result — or one line
  saying the change is not user-observable)

## Next session entry point

- (where to start when picking this up)
