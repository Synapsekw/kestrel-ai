### Task 2: Hardening items that affect packaged behaviour

- [ ] Orphan sweep (`app/jobs/startup.py`): when a project is opened, any `Job` row in `queued` or `running` from a previous process (no live context in the runner) is marked `failed` with error "interrupted by application restart" (queued -> `cancelled`); test with a project DB prepared by hand.
- [ ] Pre-seed `Arial.ttf` for Ultralytics plots: copy the font Ultralytics expects into the user config dir on first run (or set `YOLO_CONFIG_DIR` under app data and ship the font in the bundle); no network on first training; test by asserting the file exists after the worker's setup step.
- [ ] Backend log file: `sidecar.rs` tees the sidecar's stdout/stderr lines to `<app_data>/logs/sidecar.log` (rotating at 5 MB) in addition to the console; `backend_info` returns `log_path`; the failure dialog (`client.tsx`) shows it (spec 11).
- [ ] `tauri.conf.json`: `app.security.csp` = `default-src 'self'; img-src 'self' http://127.0.0.1:* data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'`; `bundle.windows.nsis` `installMode: "currentUser"`; `version` 0.1.0; verify `pnpm tauri dev` still boots with the CSP (Konva uses canvas; check no CSP violations in the webview console).
- [ ] Commit `chore: packaging hardening (orphan sweep, font pre-seed, sidecar log, csp)`.

---

