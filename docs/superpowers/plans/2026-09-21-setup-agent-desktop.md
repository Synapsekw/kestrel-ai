# Setup agent desktop rebuild

Source: main `75aa11b`, with the setup-agent/catalog application tree already verified at `da2e475`.
The user requested rebuilding the Windows app; routine local installation is included.

## Budget and execution DAG

No application behavior changes are planned. Reuse the shared Python interpreter without linking
its directory into the worktree. Freeze/package run as background shell processes with progress.
Carry forward the preceding feature's passed source gates only while backend/frontend/contract
trees remain identical; run fresh frozen, Rust, native-build and installed-app checks.
Use a disposable three-image sample; installed catalog reads are 44 bounded records and image reads
are limited to three. No bulk model downloads or paid provider requests are needed for this rebuild.

Prepare worktree -> fresh backend freeze -> frozen CUDA/worker/export smoke -> Rust tests and
native installer -> install + hash comparison -> installed UI/catalog verification -> evidence,
merge, cleanup and wrapup. Packaging/compute gates run sequentially to avoid job-runner contention.
Verification-driver preparation can run while the backend freezes. This chain is the critical path.

## Checklist

- [x] Build a fresh backend bundle with the three existing offline starters.
- [x] Verify frozen health, CUDA inference, training worker, ONNX export and keyring behavior.
- [x] Build the native Windows release/installer and run the now-applicable Rust gate.
- [x] Save the installer outside the worktree, gracefully close any installed app and install.
- [x] Check installed executable hashes, startup/shutdown, setup drawer, provider readiness,
      44 starters/eight families and real background model registration.
- [x] Confirm application source matches the previously verified tree; finish required gates.
- [x] Record evidence and operator steps, merge/push, remove the worktree and log the session.

Completed: evidence merged/pushed at `f15f89b`, owned worktree/branch removed, updated installed
app reopened normally. See `docs/evidence/setup-agent-desktop/README.md` and the 20:03 vault session.
