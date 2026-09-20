---
type: adr
date: 2026-09-18
status: accepted
tags: [decision, gotcha]
related: []
---

# Gotcha: Inno Setup, because NSIS and MSI cap out at 2 GB

## Context

The installer needs to package a CUDA sidecar that is 3.46 GB with no trimmable margin
(`torch_cuda.dll` imports the big CUDA DLLs by name; the frozen smoke test catches removal
attempts). NSIS (`makensis` 32-bit payload offsets) and MSI (compound file with 512-byte
sectors, one embedded cab) both fail above 2 GB.

## Decision

Use Inno Setup 6 (LZMA2, no 2 GB limit, per-user install, Start Menu shortcut, uninstaller),
compiled by the `innosetup-compiler` npm package inside `frontend/node_modules` (no system
install required), wrapping `tauri build --no-bundle` output plus the WebView2 bootstrapper.
Spec section 10 updated.

## Rationale

Rejected WiX (external cabs mean a multi-file distribution) and a split/side-loaded payload (the
spec asks for one installer). Inno Setup is the only one of the evaluated options with no 2 GB
ceiling and a single-file installer.

## Consequences

- Positive: a single installer file works despite the 3.46 GB payload; no system-level installer
  toolchain needed (npm-packaged compiler).
- Negative: Inno Setup is a build-time dependency the packaging pipeline must invoke correctly
  (`tauri build --no-bundle` first, then the Inno compile step).
- Open follow-ups: none.

## Related

-
