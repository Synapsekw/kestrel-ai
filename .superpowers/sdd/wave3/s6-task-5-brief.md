### Task 5: README and final verification

- [ ] README: build, install, dev against mock and real backend, tests (backend incl. gpu and live markers, contract, frontend unit and e2e, checkpoint and acceptance drivers), troubleshooting (sidecar log path, ports, GPU not detected, re-running the installer), and the environment facts (reference machine, pins).
- [ ] Run on `main`: `pytest -q`, `pytest -m gpu -q`, `ruff`, `pnpm --dir contract check`, `pnpm lint/test/build/e2e`; paste the results.
- [ ] Commit `docs: readme for build, install, run and tests`.

## Self-review checklist

- Spec 10 (PyInstaller with hidden imports, CUDA DLLs, smoke test; NSIS with WebView2 bootstrapper; settings and env overrides; security), 11 (sidecar death dialog with log path), 13.4 checkpoint 4, 13.5 acceptance, success criteria (installer size, cold start) are each mapped to a task.
- Every step names the command and the expected output; timings and sizes are recorded, not estimated.
