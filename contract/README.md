# Contract

`openapi.yaml` is the source of truth for the backend API (spec section 2). Only the goal
owner edits it; sub-projects request changes.

- `pnpm lint`: Spectral lint.
- `pnpm mock`: Prism mock server on http://127.0.0.1:4010 (any bearer token is accepted).
- `pnpm generate`: regenerate `client/schema.d.ts` (committed; CI fails when it is stale).
- `pnpm check`: lint, regenerate and fail on a diff.

`client/index.ts` wraps the generated types with `openapi-fetch` and is imported by the
frontend as `@contract/client`.
