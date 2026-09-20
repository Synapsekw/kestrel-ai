---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-20-1814-rotated-boxes-wave-1]]"]
---

# Gotcha: an OpenAPI `default` makes the generated TypeScript field *required*

## Context

Adding `angle` to `BoxCreate` and `BoxUpdate` in `contract/openapi.yaml`, the obvious spelling is:

```yaml
angle: { type: number, minimum: 0, exclusiveMaximum: 180, default: 0 }
```

The field is not in `required`, so it reads as optional. It is not.

`openapi-typescript` (7.x, as pinned in `contract/package.json`) treats a property carrying a
`default` as always-present in the generated type — the server will fill it in, so the *response*
always has it. It applies that reasoning to request bodies too. The result is `angle: number`, not
`angle?: number`, on both `BoxCreate` and `BoxUpdate`.

This broke `pnpm -C frontend build` at roughly 14 call sites that had no reason to mention `angle`,
and the failures pointed at the call sites rather than at the contract, so the cause was several
steps away from the symptom.

The same behaviour is already live elsewhere in this contract and had simply never been noticed:
`PreannotateRequest.imgsz` and `.conf` both carry a `default` and both generate as non-optional.

## Decision

Do not put `default:` on an optional **request** property in `contract/openapi.yaml`. State the
default in the property's `description` instead, and let the server-side pydantic default be the
real implementation.

`default:` on a **response** property is fine and accurate — the server does always send it.

## Rationale

The alternative is to keep the YAML `default` and mark every such field optional by hand, which the
generator does not support without post-processing a generated file that must never be hand-edited
(`AGENTS.md` invariant).

Losing `default:` costs only machine-readable documentation, and only on the request side. The
behaviour it documented — "omitting `angle` means 0" — is implemented for real by
`BoxCreate.angle: float = Field(default=0.0)`, and the description now says so in prose.

Note the two schemas needed *different* prose, which is its own small trap: "omitting it means 0" is
true for `BoxCreate`, but for `BoxUpdate` — a PATCH — omitting a field leaves the stored value
unchanged. A single boilerplate sentence across both would have been wrong on one of them.

## Consequences

- Positive: `BoxCreate["angle"]` and `BoxUpdate["angle"]` generate as `angle?: number`, the frontend
  builds, and the contract no longer implies a constraint the server does not enforce.
- Negative: the OpenAPI document no longer machine-documents the request-side default; a reader has
  to read the description. Any future consumer generating a validating client gets nothing from the
  contract on this point.
- Open follow-ups: `PreannotateRequest.imgsz`/`.conf` have the same shape and are presumably
  non-optional in the client today for the same reason. Nothing is broken by it, but if either is
  ever meant to be omittable from a request, it will need the same treatment.

## Related

- [[2026-09-20-1814-rotated-boxes-wave-1]] — the block this surfaced in (commit `6efa0b7`)
- `contract/openapi.yaml`, `contract/package.json` (`openapi-typescript` version)
