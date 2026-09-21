# Setup agent desktop rebuild — 2026-09-21

Application source: `75aa11b`, identical application trees to verified setup-agent code `da2e475`.
Build workspace: `task/setup-agent-desktop`. This rebuild packages the setup drawer and the full
44-checkpoint, eight-family detection catalog into the Windows desktop app.

## Evidence collected

- Fresh PyInstaller backend: **204 seconds**, **3,522.9 MiB**, 14,161 files. Three offline YOLO11
  starters are bundled; other catalog models are acquired only when selected.
- Frozen smoke: **passed in 23.13 seconds**. Healthy startup, NVIDIA RTX 5070 Ti CUDA, three-image
  import, actual YOLO11 prediction, one-epoch worker training and 10.1 MiB ONNX export. Existing
  Anthropic credentials were detected and left untouched. Smoke accuracy is not a benchmark.
- Rust gate: **8 passed**, zero failures. The fresh frozen sidecar is present, so this gate ran.
- Packaged frontend TypeScript/Vite build passed; the existing large-chunk advisory remains.

- Native release and Inno installer passed in **427 seconds** (367.812 seconds compression).
  Saved installer: `dist/Kestrel AI_0.1.0_Setup-agent_2026-09-21_x64-setup.exe`, **1,943,889,030 bytes**.
- Installation exited **0**, with no reboot needed. Installed app and sidecar SHA-256 values
  match the fresh build; identities are recorded in `package.json`.
- Installed WebView2 verification: **16 checks passed**, no JavaScript or cleanup errors. First
  launch after installation reached Projects in **3.052s**; final verification launch **1.966s**,
  warm launch **2.443s**. These are not measurements with a flushed Windows file cache.
- Both stored provider keys appeared ready. The actual installed API exposes 44 detection starters
  across eight families; every selector choice was counted. A real YOLO26 nano download registered
  80 COCO classes, and packaged inference ran successfully. A second run confirmed cache reuse.
  Zero proposals on the chosen smoke image is a runtime result, not an accuracy assessment.
- Four screenshots were captured from the installed app and visually inspected. Temporary projects
  were forgotten and owned app/sidecar processes exited cleanly. Operator projects were not edited.
- Independent driver review passed after hardening failure cleanup to cancel/wait for active jobs
  before forgetting the test project. The first run caught a test timing issue: it measured the
  drawer during its 220ms entrance animation. `layout-investigation.json` records right=1040.577
  mid-animation versus right=1024 after completion at a 1024px viewport. The driver now awaits the
  actual animation before measuring. No application change or second installer was required.

## Source gate continuity

The application source is unchanged from the preceding feature block. Verified Git tree identities
are recorded in `package.json`: backend `fb0480683a2cfa409e2cf15f3411cda289df3c77`, frontend
`9c25761d06ce668f279082f73995d69a3dd8a464`, contract `5f46acda7db22b61e6171515ae39475fd4a97d18`.
The already-passed contract check, Ruff, **666 backend tests**, frontend lint, **533 unit tests**
and **59 browser tests** therefore carry forward from `docs/evidence/setup-agent/README.md`.
This block adds fresh frozen/backend, Rust, production/native build, installation and actual
installed-app checks; it does not need a duplicate source gate run against identical trees.

## Reproduction and bounds

Use CONTRIBUTING's backend freeze, frozen smoke, Rust test and `build:installer` commands from a
task worktree. The shared Python environment is passed via `-Venv`; it is never linked into the
worktree. Build logs and retained smoke scratch are in the ignored main-checkout directory
`dist/setup-agent-desktop-2026-09-21/`.

`verify-installed.cjs` launches the real installed app with a private WebView2 debugging port and
reads its owned bundled backend connection in memory. It uses a disposable project and three copied
photographs, validates the setup drawer without sending a chat, checks all 44 UI model choices,
acquires YOLO26 nano through the actual background download, predicts on one sample and checks
normal/warm startup and shutdown. No API stubs or paid provider calls are used. Screenshot capture
is limited to disposable-project screens; recent-project lists and credentials are not captured.

The installer uses the machine's existing WebView2 runtime. These checks do not claim a full
cloud-provider acceptance run, every-model training benchmark or first-labeling accuracy result.

## Operator walkthrough

1. Open **Kestrel AI** from Start. Open **Setup agent** in the header.
2. Choose GPT or Claude, describe your detector, then review the classes, model and project folder.
3. Create the project, import images, select a first batch, estimate and start labeling, then review suggestions.
4. In **Models**, choose a different YOLO family and model, then **Download and add**.
