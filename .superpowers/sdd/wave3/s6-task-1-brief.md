### Task 1: Full PyInstaller spec and frozen smoke script

**Interfaces:** `backend/scripts/smoke_frozen.ps1` prints `health ok`, `cuda True <gpu name>`, `predict ok <n> boxes`, `worker ok` and exits non-zero on any failure.

- [ ] Replace the S0 excludes in `machinery_backend.spec` with: `hiddenimports=collect_submodules("app") + collect_submodules("ultralytics") + ["torch", "torchvision", "cv2", "onnx", "onnxslim", "onnxruntime", "anthropic", "openai", "keyring.backends.Windows", "win32ctypes.pywin32", "pywin32_system32", "alembic", "sqlalchemy.dialects.sqlite", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto", "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on", "websockets", "anyio._backends._asyncio"]`, `datas=[("app/db/migrations", "app/db/migrations")] + collect_data_files("ultralytics") + collect_data_files("torch", include_py_files=False)`, `binaries=collect_dynamic_libs("torch") + collect_dynamic_libs("torchvision") + collect_dynamic_libs("onnxruntime")`. Use `collect_all("ultralytics")` if plain collection misses `cfg/*.yaml`. Set `console=False` for the exe (the launcher captures stdout/stderr through the shell plugin regardless) only after confirming the stdout JSON line still reaches Tauri (`CommandEvent::Stdout`); keep `console=True` otherwise and document why.
- [ ] Add `backend/app/health.py` `gpu` field (`{"available": bool, "name": str | null}`) computed on first request in a thread with a 10 s timeout so health stays fast; contract: add the optional `gpu` object to `Health` (goal owner edits the contract; ask before you change it).
- [ ] Write `smoke_frozen.ps1`: run the exe with `APP_TOKEN`, `APP_PORT=0`, parse the port from the JSON line, poll health until 200 (fail after 20 s), check `gpu.available`, create a temp project, import 3 sample frames, import `E:\Dev\Yolo\models\yolo11n.pt`, call preannotate on one image (`imgsz 640`), train 1 epoch on a hand-made dataset (reuse the checkpoint script logic) to prove the frozen `worker` path with DataLoader workers, export ONNX, then stop the process by PID. Record timings.
- [ ] Run `build.ps1` then `smoke_frozen.ps1` on the reference machine; paste the output in the report; record the `dist/machinery-backend` size in MB.
- [ ] Commit `build: full pyinstaller bundle with cuda torch; frozen smoke script`.

---

