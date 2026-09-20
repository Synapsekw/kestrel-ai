---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: []
---

# Websocket token as a query parameter

## Context

The browser needs to authenticate its `/api/v1/events` websocket connection, but browsers cannot
set custom headers on a websocket connect.

## Decision

Pass the auth token as a `?token=` query parameter on the websocket URL. Connects that fail to
authenticate are closed with code 4401.

## Rationale

Headers are not an option for browser-initiated websocket connects, so the token has to travel
some other way; the query parameter is the standard workaround.

## Consequences

- Positive: works from a plain browser websocket client with no special transport.
- Negative: tokens can end up in server access logs and browser history via the URL.
- Open follow-ups: none.

## Related

-
