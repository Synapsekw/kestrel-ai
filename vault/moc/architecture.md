---
type: moc
status: active
tags: [moc, architecture]
---

# Architecture

Map of where each part of Kestrel AI lives. Stack details and the pitch: [[00-north-star]].

## Layers

- Backend (FastAPI sidecar: projects, datasets, jobs, training, inference) — `backend/`
- Frontend shell (Tauri 2 + React/TypeScript/Vite) — `frontend/`
- UI components (Site office design system) — `frontend/src/ui/`
- Contract (OpenAPI source of truth, generated TS client, mock server) — `contract/`

## Related

- [[product]] — purpose, users, design language
- [[2026-09-17-kestrel-ai-app-design]] — master spec
- [[roadmap]]
