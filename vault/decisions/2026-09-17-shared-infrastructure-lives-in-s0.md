---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Shared infrastructure lives in S0

## Context

The job runner, event bus, SQLite models, migrations and project store are needed by three Wave 1
sub-projects (S1, S3, S4). Built separately, each would invent its own.

## Decision

Put all of it in S0. S1, S3 and S4 register their job types through
`app.jobs.registry.register_job_type` instead of building their own runner.

## Rationale

One shared implementation avoids three divergent job runners and event buses, and keeps the
project store and migrations in a single place all sub-projects depend on.

## Consequences

- Positive: no duplicated infrastructure across Wave 1 sub-projects.
- Negative: S0 must ship before S1/S3/S4 can start their job-type work.
- Open follow-ups: none.

## Related

-
