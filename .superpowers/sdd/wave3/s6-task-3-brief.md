### Task 3: Installer build and install on the reference machine

- [ ] `pnpm tauri build` (NSIS). Record installer size (must be < 6 GB) and build time. If the `_internal` resource mapping does not land next to the sidecar exe in the install dir, adjust `bundle.resources` (Tauri puts resources under the install root on Windows; `_internal/` must sit beside `machinery-backend-x86_64-pc-windows-msvc.exe`).
- [ ] Install with the generated setup exe (silent `/S` is fine), launch from the Start Menu shortcut with a stopwatch script (`Get-Process` start time to first `GET /api/v1/health 200` in `sidecar.log`, and to the Projects heading via CDP): record cold start (< 15 s) and warm start.
- [ ] Verify the installed app: sidecar spawns (process list), health passes, project creation works, closing terminates the sidecar, uninstall removes the install dir (app data stays).
- [ ] Commit `docs: installer build and install evidence` with the numbers in `docs/progress.md` (goal owner records checkpoint 4).

---

