import type { AssetModel, AssetModelRun, AssetModelVersion, AssetSpec } from "@contract/client";

/** An asset model with two versions; v2 (the current one) changed the shell height. */
export const MODEL: AssetModel = {
  id: "m1",
  name: "Feed tank T-101",
  asset_type: "tank",
  tag: "T-101",
  status: "ready",
  current_version: 2,
  live_run_id: null,
  captured_on: null,
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-02T09:00:00Z",
  frame: null,
  review: null,
};

const SHELL = {
  id: "shell",
  name: "Shell",
  group: "Shell",
  shape: "cylinder",
  params: { id: 3000, thickness: 10, height: 6000, sweep_deg: 360 },
  placement: { origin_mm: [0, 0, 0], axis: [0, 1, 0] },
  source: { kind: "drawing", id: "d1", region: [0.1, 0.1, 0.4, 0.6], note: null },
  confidence: "high",
  note: null,
} as const;

const N7 = {
  id: "N7",
  name: "Nozzle N7",
  group: "Nozzle",
  shape: "nozzle",
  params: { dn: 80, od: 88.9, projection: 200, flange_od: 200, flange_t: 20, blind: false },
  placement: { host: "shell", bearing_deg: 90, elevation_mm: 1500 },
  source: { kind: "assumed", note: "standard projection for DN80" },
  confidence: "medium",
  note: null,
} as const;

export const SPEC_V1: AssetSpec = {
  asset: { tag: "T-101", type: "tank", name: "Feed tank" },
  parts: [structuredClone(SHELL), structuredClone(N7)] as AssetSpec["parts"],
};

export const SPEC_V2: AssetSpec = {
  ...SPEC_V1,
  parts: [
    { ...structuredClone(SHELL), params: { ...SHELL.params, height: 6500 } },
    structuredClone(N7),
  ] as AssetSpec["parts"],
};

export const VERSION_1: AssetModelVersion = {
  id: "v1",
  model_id: "m1",
  version: 1,
  kind: "agent",
  glb_status: "ready",
  source_ids: [{ type: "drawing", id: "d1" }],
  run_id: "run1",
  note: "Built from the general arrangement drawing",
  part_count: 2,
  meta: null,
  created_at: "2026-10-01T10:00:00Z",
};

export const VERSION_2: AssetModelVersion = {
  ...VERSION_1,
  id: "v2",
  version: 2,
  kind: "manual",
  run_id: null,
  note: "shell: height 6000 → 6500 mm",
  created_at: "2026-10-02T09:00:00Z",
};

/** A finished run that wrote v2 and compared it with a scan. */
export const RUN: AssetModelRun = {
  id: "run2",
  model_id: "m1",
  job_id: "jr2",
  provider: "anthropic",
  model_name: "claude-opus-5-5",
  mode: "refine",
  notes: null,
  state: "finished",
  stop_reason: null,
  phase: "done",
  steps: [],
  summary: "Refined the shell height from the scan.",
  open_questions: [],
  usage: { input_tokens: 1000, output_tokens: 200 },
  sources: [{ type: "point_cloud", id: "c1" }],
  version: 2,
  comparison: {
    cloud_id: "c1",
    transform: { origin: [0, 0, 0], yaw_deg: 0 },
    overall: { n: 5000, median_mm: 6.1, p95_mm: 14.2 },
    parts: [{ id: "N7", n: 120, median_mm: 4.2, p95_mm: 9.8 }],
    inlier_share: 0.92,
    points_used: 200000,
  } as unknown as AssetModelRun["comparison"],
  started_at: "2026-10-02T08:40:00Z",
  ended_at: "2026-10-02T08:58:00Z",
};

/** A finished build that wrote v1: two steps, a summary and one open question. */
export const RUN_FINISHED: AssetModelRun = {
  ...RUN,
  id: "run1",
  job_id: "jr1",
  mode: "build",
  notes: "N7 is at 270°, not 90°",
  phase: "done",
  steps: [
    { n: 1, tool: "read_drawing", ok: true, summary: "Read the GA drawing.", has_thumb: false },
    { n: 2, tool: "write_spec", ok: true, summary: "Wrote the shell and nozzles.", has_thumb: true },
  ],
  summary: "Built the shell and nozzles.",
  open_questions: ["Roof type?"],
  usage: { input_tokens: 9000, output_tokens: 500 },
  sources: [{ type: "drawing", id: "d1" }],
  version: 1,
  comparison: null,
  started_at: "2026-10-01T09:40:00Z",
  ended_at: "2026-10-01T09:58:00Z",
};
