import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { pdfDrawing } from "@/mapws/drawings/testFixtures";
import { MODEL, RUN, RUN_FINISHED, SPEC_V1, SPEC_V2, VERSION_1, VERSION_2 } from "@/test/assetModelFixtures";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { useJobToasts, useToastStore } from "@/ui";

vi.mock("@/assetmodels/viewer/ModelViewer", async () => ({
  ModelViewer: (await import("@/test/fakeModelViewer")).FakeModelViewer,
}));
import { callsTo, emitParts, emitPick, emitState, fake, resetFake } from "@/test/fakeModelViewer";
import { ASSET_FINDINGS, MODEL_REVIEWED, PLACEMENTS } from "@/test/assetFindingFixtures";
import { RUN_POLL_MAX_FAILURES, RUN_POLL_MS } from "@/assetmodels/run/useLiveRun";
import { AssetModelWorkspace } from "./AssetModelWorkspace";

/** Extra routes go first: the first matching route wins, so a test can override a default. */
const routes = (extra: unknown[] = []) => [
  ...extra,
  { method: "GET", path: /\/asset-models$/, body: { items: [MODEL] } },
  { method: "GET", path: /\/asset-models\/m1$/, body: MODEL },
  { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2, VERSION_1] } },
  { method: "GET", path: /\/versions\/2$/, body: { ...VERSION_2, spec: SPEC_V2, warnings: [] } },
  { method: "GET", path: /\/versions\/1$/, body: { ...VERSION_1, spec: SPEC_V1, warnings: [] } },
  { method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [] } },
];

afterEach(() => localStorage.clear());

const open = (extra: unknown[] = []) => {
  const client = fakeClient(routes(extra) as never);
  renderWithProviders(
    <>
      <AssetModelWorkspace />
      <LocationProbe />
    </>,
    {
      api: client.api,
      route: `/p/${PROJECT_ID}/models/m1`,
      path: "/p/:projectId/models/:modelId?",
    },
  );
  return client;
};

const resetCalls = () => {
  fake.calls = [];
};

/** URL.createObjectURL / revokeObjectURL (jsdom has neither), restored by vi.unstubAllGlobals. */
function stubObjectUrls() {
  const create = vi.fn(() => "blob:file");
  const revoke = vi.fn();
  class TestURL extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal("URL", TestURL);
  return { create, revoke };
}

/** Records each anchor click (href and download name) instead of navigating; restored in afterEach. */
function recordClicks() {
  const clicked: { href: string; download: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute("href") ?? "", download: this.download });
  });
  return clicked;
}

const openDetails = async () => {
  await screen.findByTestId("model-workspace");
  fireEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
  fireEvent.click(await screen.findByRole("button", { name: /details…/i }));
  return screen.findByRole("dialog", { name: /asset model details/i });
};

describe("AssetModelWorkspace", () => {
  beforeEach(() => {
    resetFake();
    useToastStore.getState().clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the empty state when there are no models", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/asset-models$/, body: { items: [] } }]);
    renderWithProviders(<AssetModelWorkspace />, {
      api,
      route: `/p/${PROJECT_ID}/models`,
      path: "/p/:projectId/models",
    });
    expect(await screen.findByText(/build a 3d model of the asset/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new asset model/i })).toBeInTheDocument();
  });

  it("lists parts by group and selects one", async () => {
    open();
    await screen.findByTestId("model-workspace");
    await screen.findByTestId("fake-model-viewer");
    act(() =>
      emitParts([
        { id: "shell", name: "Shell", group: "Shell" },
        { id: "N7", name: "Nozzle N7", group: "Nozzle" },
      ]),
    );
    const parts = await screen.findByRole("tabpanel", { name: /parts/i });
    fireEvent.click(within(parts).getByRole("button", { name: /nozzle n7/i }));
    expect(await screen.findByRole("tabpanel", { name: /part/i })).toHaveTextContent(/projection/i);
    expect(callsTo("select")).toContainEqual(["N7"]);
  });

  it("saving an edit posts a new version with a readable note", async () => {
    const { requests } = open([
      {
        method: "POST",
        path: /\/asset-models\/m1\/versions$/,
        status: 201,
        body: {
          version: { ...VERSION_2, version: 3, kind: "manual" },
          job: { id: "j3", type: "asset_model_glb", state: "queued" },
        },
      },
    ]);
    await screen.findByTestId("model-workspace");
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    const input = await screen.findByLabelText(/projection/i);
    fireEvent.change(input, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /save as new version/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const body = requests.find((r) => r.method === "POST")!.body as {
      note: string;
      spec: { parts: { id: string; params: Record<string, number> }[] };
    };
    expect(body.note).toBe("N7: projection 200 → 250 mm");
    expect(body.spec.parts.find((p) => p.id === "N7")!.params.projection).toBe(250);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Saved version 3"),
    );
  });

  it("an invalid edit shows the server's errors inline", async () => {
    open([
      {
        method: "POST",
        path: /\/versions$/,
        status: 422,
        body: {
          error: {
            code: "invalid_spec",
            message: "The model spec has errors.",
            details: {
              errors: [
                {
                  code: "bad_geometry",
                  part_id: "N7",
                  message: "the flange must be thinner than the projection",
                },
              ],
            },
          },
        },
      },
    ]);
    await screen.findByTestId("model-workspace");
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    fireEvent.change(await screen.findByLabelText(/projection/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /save as new version/i }));
    expect(await screen.findByText(/flange must be thinner/i)).toBeInTheDocument();
  });

  it("compares two versions", async () => {
    open();
    await screen.findByTestId("model-workspace");
    fireEvent.click(screen.getByRole("tab", { name: /versions/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /compare v1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /compare v2/i }));
    const diff = await screen.findByRole("region", { name: /v1 → v2/i });
    expect(within(diff).getByText(/changed/i)).toBeInTheDocument();
    expect(diff).toHaveTextContent(/params\.height/);
  });

  it("restores an older version", async () => {
    const { requests } = open([
      {
        method: "POST",
        path: /\/versions\/1\/restore$/,
        status: 201,
        body: {
          version: { ...VERSION_1, version: 3, kind: "manual" },
          job: { id: "j4", type: "asset_model_glb", state: "queued" },
        },
      },
    ]);
    await screen.findByTestId("model-workspace");
    fireEvent.click(screen.getByRole("tab", { name: /versions/i }));
    fireEvent.click(await screen.findByRole("button", { name: /restore v1/i }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && /\/versions\/1\/restore$/.test(r.url))).toBe(true),
    );
  });

  it("group switch hides the group in the viewer", async () => {
    open();
    await screen.findByTestId("model-workspace");
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    fireEvent.click(await screen.findByRole("switch", { name: /nozzle/i }));
    expect(callsTo("setGroupVisible")).toContainEqual(["Nozzle", false]);
  });

  it("lists the spec's parts when the machine has no WebGL", async () => {
    open();
    await screen.findByTestId("fake-model-viewer");
    act(() => emitState("no-webgl"));
    const parts = await screen.findByRole("tabpanel", { name: /parts/i });
    expect(within(parts).getByRole("button", { name: /nozzle n7/i })).toBeInTheDocument();
    expect(within(parts).getByRole("button", { name: /shell/i })).toBeInTheDocument();
  });

  it("a failed GLB shows a notice and the parts from the spec", async () => {
    const failed = { ...VERSION_2, glb_status: "failed" };
    open([
      { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [failed, VERSION_1] } },
      { method: "GET", path: /\/versions\/2$/, body: { ...failed, spec: SPEC_V2, warnings: [] } },
    ]);
    expect(await screen.findByText("The 3D model could not be built.")).toBeInTheDocument();
    expect(screen.queryByTestId("fake-model-viewer")).not.toBeInTheDocument();
    const parts = await screen.findByRole("tabpanel", { name: /parts/i });
    expect(await within(parts).findByRole("button", { name: /nozzle n7/i })).toBeInTheDocument();
  });

  it("a pending GLB says it is being built", async () => {
    const pending = { ...VERSION_2, glb_status: "pending" };
    open([
      { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [pending, VERSION_1] } },
      { method: "GET", path: /\/versions\/2$/, body: { ...pending, spec: SPEC_V2, warnings: [] } },
    ]);
    expect(await screen.findByText(/building the 3d model/i)).toBeInTheDocument();
  });

  it("treats a runs list the backend does not serve yet (501) as no runs", async () => {
    const { requests } = open([
      {
        method: "GET",
        path: /\/asset-models\/m1\/runs$/,
        status: 501,
        body: { error: { code: "not_implemented", message: "Not implemented yet.", details: {} } },
      },
    ]);
    await screen.findByTestId("fake-model-viewer");
    await waitFor(() => expect(requests.some((r) => /\/runs$/.test(r.url))).toBe(true));
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    expect(screen.getByRole("switch", { name: /show scan overlay/i })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    expect(await screen.findByRole("tabpanel", { name: /part/i })).not.toHaveTextContent(/median/i);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("shows the run's deviation and the scan overlay", async () => {
    const buf = new Float32Array([0, 0, 0, 1, 1, 1]).buffer;
    const fetchMock = vi.fn(async () => new Response(buf, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    open([{ method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [RUN] } }]);
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    const overlay = screen.getByRole("switch", { name: /show scan overlay/i });
    await waitFor(() => expect(overlay).toBeEnabled());
    fireEvent.click(overlay);
    await waitFor(() => expect(callsTo("setOverlay").some(([p]) => p instanceof Float32Array)).toBe(true));
    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toMatch(/\/runs\/run2\/overlay\/c1\?token=t$/);
    fireEvent.click(overlay);
    expect(callsTo("setOverlay").at(-1)).toEqual([null]);
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    expect(await screen.findByText("median 4.2 mm · p95 9.8 mm")).toBeInTheDocument();
  });

  it("downloads the spec and the GLB through same-origin blob URLs named after the model and version", async () => {
    const { create, revoke } = stubObjectUrls();
    const clicked = recordClicks();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([103, 108, 84, 70]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    open();
    await screen.findByTestId("fake-model-viewer");
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /spec \(json\)/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("menuitem", { name: /spec \(json\)/i }));
    expect(clicked).toEqual([{ href: "blob:file", download: "Feed tank T-101-v2.json" }]);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /3d model \(glb\)/i }));
    await waitFor(() => expect(clicked).toHaveLength(2));
    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toMatch(
      /\/asset-models\/m1\/versions\/2\/glb\?token=t$/,
    );
    expect(clicked[1]).toEqual({ href: "blob:file", download: "Feed tank T-101-v2.glb" });
    expect(create).toHaveBeenCalledTimes(2);
    // Each blob URL is released on the next turn.
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(2));
  });

  it("a failed GLB download says so without the URL", async () => {
    stubObjectUrls();
    const clicked = recordClicks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 404 })),
    );
    open();
    await screen.findByTestId("fake-model-viewer");
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /3d model \(glb\)/i }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
        "The 3D model could not be downloaded.",
      ]),
    );
    expect(clicked).toEqual([]);
  });

  it("details renames the model without ever sending an empty name", async () => {
    const { requests } = open([
      {
        method: "PATCH",
        path: /\/asset-models\/m1$/,
        body: { ...MODEL, name: "Feed tank", tag: null, asset_type: "tank" },
      },
    ]);
    const dialog = await openDetails();
    const name = within(dialog).getByLabelText(/^name/i);
    fireEvent.change(name, { target: { value: "  " } });
    expect(within(dialog).getByRole("button", { name: /^save$/i })).toBeDisabled();
    fireEvent.change(name, { target: { value: " Feed tank " } });
    fireEvent.change(within(dialog).getByLabelText(/^tag/i), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({
      name: "Feed tank",
      tag: null,
      asset_type: "tank",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("details deletes the model only after a confirm, then leaves for the models page", async () => {
    const { requests } = open([{ method: "DELETE", path: /\/asset-models\/m1$/, status: 204 }]);
    const dialog = await openDetails();
    fireEvent.click(within(dialog).getByRole("button", { name: /delete asset model…/i }));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    const confirm = screen.getByRole("dialog", { name: "Are you sure?" });
    expect(confirm).toHaveTextContent(/every version and its 3d model go with it/i);
    fireEvent.click(within(confirm).getByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && /\/asset-models\/m1$/.test(r.url))).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models`));
    expect(screen.getByTestId("location")).not.toHaveTextContent(/models\/m1/);
    expect(await screen.findByText(/build a 3d model of the asset/i)).toBeInTheDocument();
  });

  it("deleting another model from the picker keeps the open model", async () => {
    const other = {
      ...MODEL,
      id: "m2",
      name: "Stack",
      tag: null,
      current_version: null,
      status: "empty" as const,
    };
    const { requests } = open([
      { method: "GET", path: /\/asset-models$/, body: { items: [MODEL, other] } },
      { method: "DELETE", path: /\/asset-models\/m2$/, status: 204 },
    ]);
    await screen.findByTestId("model-workspace");
    fireEvent.click(screen.getByRole("button", { name: /asset model: feed tank/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Stack" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Are you sure?" })).getByRole("button", { name: "Yes" }),
    );
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && /\/asset-models\/m2$/.test(r.url))).toBe(true),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`);
    expect(screen.getByRole("button", { name: /asset model: feed tank/i })).toBeInTheDocument();
  });

  it("a failed versions read offers a retry instead of saying there are none", async () => {
    const { requests } = open([
      {
        method: "GET",
        path: /\/asset-models\/m1\/versions$/,
        status: 500,
        body: { error: { code: "internal", message: "Boom.", details: {} } },
      },
    ]);
    await screen.findByTestId("model-workspace");
    fireEvent.click(screen.getByRole("tab", { name: /versions/i }));
    const panel = await screen.findByRole("tabpanel", { name: /versions/i });
    expect(await within(panel).findByText("The versions could not be loaded.")).toBeInTheDocument();
    expect(within(panel).queryByText(/no versions yet/i)).not.toBeInTheDocument();
    const reads = () => requests.filter((r) => r.method === "GET" && /\/versions$/.test(r.url)).length;
    const before = reads();
    fireEvent.click(within(panel).getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it("a part with no scan points says so instead of printing null", async () => {
    const run = {
      ...RUN,
      comparison: {
        ...(RUN.comparison as object),
        parts: [{ id: "N7", n: 0, median_mm: null, p95_mm: null }],
      },
    };
    open([{ method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [run] } }]);
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    await waitFor(() => expect(screen.getByRole("switch", { name: /show scan overlay/i })).toBeEnabled());
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    const part = await screen.findByRole("tabpanel", { name: /part/i });
    expect(part).toHaveTextContent("no scan points on this part");
    expect(part).not.toHaveTextContent(/null/);
  });

  it("a viewer that starts running gets the panels' view state and the selection", async () => {
    open();
    await screen.findByTestId("fake-model-viewer");
    act(() => emitParts([{ id: "N7", name: "Nozzle N7", group: "Nozzle" }]));
    fireEvent.click(await screen.findByRole("switch", { name: /nozzle/i }));
    fireEvent.click(await screen.findByRole("button", { name: /nozzle n7/i }));
    resetCalls();
    act(() => emitState("running"));
    expect(callsTo("setGroupVisible")).toContainEqual(["Nozzle", false]);
    expect(callsTo("setCut")).toEqual([[null]]);
    expect(callsTo("setLevels")).toEqual([[false]]);
    expect(callsTo("setHeadOff")).toEqual([[false]]);
    expect(callsTo("select")).toEqual([["N7"]]);
  });
  describe("findings on the asset", () => {
    const review = [
      { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
      { method: "GET", path: /\/asset-models\/m1$/, body: MODEL_REVIEWED },
      { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
      { method: "GET", path: /\/placements$/, body: PLACEMENTS },
      { method: "GET", path: /\/poses$/, body: { items: [], next: null } },
    ];
    const POSE = {
      image_id: "img-1",
      position: [1, 2, 3],
      target: [0, 0, 0],
      up: [0, 1, 0],
      hfov_deg: 70,
      vfov_deg: 52,
      source: "exif_gimbal",
      accuracy_m: 3,
      sequence: "Flight 1",
      outcome: "finding",
      updated_at: "2026-10-03T00:00:00Z",
    };

    it("puts the view tools and the Model, Findings and Photos topics on one rail", async () => {
      open(review);
      const rail = await screen.findByRole("toolbar", { name: /model view tools/i });
      for (const name of [/^cut/i, /^levels/i, /^model/i, /^findings/i, /^photos/i]) {
        expect(within(rail).getByRole("button", { name })).toBeInTheDocument();
      }
      expect(await screen.findByRole("switch", { name: /see through/i })).toBeInTheDocument();
    });

    it("sends the placements to the view and opens the Findings topic on a picked finding", async () => {
      open(review);
      await screen.findByTestId("model-workspace");
      await waitFor(() => expect(callsTo("setPlacements").at(-1)?.[0]).toHaveLength(2));
      act(() => emitPick({ kind: "finding", id: "f1" }));
      const panel = await screen.findByTestId("rail-panel");
      expect(panel).toHaveAttribute("data-topic", "findings");
      expect(within(panel).getByRole("option", { name: /F-0042/ })).toHaveAttribute("aria-selected", "true");
    });

    it("the view switches reach the engine", async () => {
      open(review);
      await screen.findByTestId("model-workspace");
      fireEvent.click(await screen.findByRole("switch", { name: /see through/i }));
      fireEvent.click(screen.getByRole("switch", { name: /turn slowly/i }));
      fireEvent.click(screen.getByRole("switch", { name: /street map/i }));
      expect(callsTo("setGhost").at(-1)).toEqual([true]);
      expect(callsTo("setAutoRotate").at(-1)?.[0]).toBe(true);
      expect((callsTo("setGround").at(-1)?.[0] as unknown[]).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("switch", { name: /street map/i }));
      expect(callsTo("setGround").at(-1)).toEqual([null]);
    });

    it("the street map is off without the asset's location", async () => {
      open([
        { method: "GET", path: /\/asset-models$/, body: { items: [{ ...MODEL_REVIEWED, frame: null }] } },
        ...review,
      ]);
      expect(await screen.findByRole("switch", { name: /street map/i })).toBeDisabled();
      expect(screen.getByText(/the street map needs the asset's location/i)).toBeInTheDocument();
    });

    // R-P6: the viewer replays its own wanted state on each engine load, so the workspace sends the
    // layers and the view switches once per new viewer element, never on a plain engine reload.
    it("a remounted view gets the layers and the view switches once; an engine reload gets neither", async () => {
      const failedV1 = { ...VERSION_1, glb_status: "failed" };
      open([
        ...review,
        { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2, failedV1] } },
        { method: "GET", path: /\/versions\/1$/, body: { ...failedV1, spec: SPEC_V1, warnings: [] } },
      ]);
      await waitFor(() => expect(callsTo("setPlacements").at(-1)?.[0]).toHaveLength(2));
      fireEvent.click(await screen.findByRole("switch", { name: /see through/i }));
      resetCalls();
      act(() => emitState("running"));
      expect(callsTo("setPlacements")).toEqual([]);
      expect(callsTo("setCameras")).toEqual([]);
      expect(callsTo("setGhost")).toEqual([]);

      fireEvent.click(screen.getByRole("tab", { name: /versions/i }));
      const list = await screen.findByRole("list", { name: "Versions" });
      fireEvent.click(within(list).getByRole("button", { name: /^v1/i }));
      await waitFor(() => expect(screen.queryByTestId("fake-model-viewer")).not.toBeInTheDocument());
      resetCalls();
      fireEvent.click(within(list).getByRole("button", { name: /^v2/i }));
      await screen.findByTestId("fake-model-viewer");
      await waitFor(() => expect(callsTo("setPlacements")).toHaveLength(1));
      expect(callsTo("setPlacements")[0]?.[0]).toHaveLength(2);
      expect(callsTo("setCameras")).toHaveLength(1);
      expect(callsTo("setGhost")).toEqual([[true]]);
    });

    // R-P7: focusing a finding or viewing from a photo stops the slow turn, in the engine and the switch.
    it("Focus and View from here stop the slow turn", async () => {
      open([{ method: "GET", path: /\/poses$/, body: { items: [POSE], next: null } }, ...review]);
      await screen.findByTestId("model-workspace");
      fireEvent.click(await screen.findByRole("switch", { name: /turn slowly/i }));
      await waitFor(() => expect(callsTo("setPlacements").at(-1)?.[0]).toHaveLength(2));
      act(() => emitPick({ kind: "finding", id: "f1" }));
      const panel = await screen.findByTestId("rail-panel");
      fireEvent.click(within(panel).getByRole("button", { name: /^focus$/i }));
      expect(callsTo("focusFinding").at(-1)?.[0]).toBe("f1");
      expect(callsTo("setAutoRotate").at(-1)).toEqual([false]);
      const rail = screen.getByRole("toolbar", { name: /model view tools/i });
      fireEvent.click(within(rail).getByRole("button", { name: /^model/i }));
      const turn = await screen.findByRole("switch", { name: /turn slowly/i });
      expect(turn).not.toBeChecked();

      fireEvent.click(turn);
      await waitFor(() => expect(callsTo("setCameras").at(-1)?.[0]).toHaveLength(1));
      act(() => emitPick({ kind: "camera", id: "img-1" }));
      fireEvent.click(await screen.findByRole("button", { name: /view from here/i }));
      expect(callsTo("viewFromPose").at(-1)?.[0]).toMatchObject({ imageId: "img-1" });
      expect(callsTo("setAutoRotate").at(-1)).toEqual([false]);
      fireEvent.click(within(rail).getByRole("button", { name: /^model/i }));
      expect(await screen.findByRole("switch", { name: /turn slowly/i })).not.toBeChecked();
    });

    it("imports a GLB from the model picker", async () => {
      const client = open([
        ...review,
        {
          method: "POST",
          path: /\/versions\/import-glb$/,
          status: 202,
          body: {
            version: { ...VERSION_2, version: 3, kind: "imported", glb_status: "pending" },
            job: { id: "jg", type: "asset_glb_import", state: "queued" },
          },
        },
      ]);
      fireEvent.click(await screen.findByRole("button", { name: /asset model: /i }));
      fireEvent.click(await screen.findByRole("button", { name: /import a glb/i }));
      fireEvent.change(await screen.findByLabelText(/glb file/i), { target: { value: "D:\\t.glb" } });
      fireEvent.click(screen.getByRole("button", { name: /^import$/i }));
      await waitFor(() =>
        expect(client.requests.some((r) => r.url.endsWith("/versions/import-glb"))).toBe(true),
      );
    });
  });
  describe("runs", () => {
    const LIVE = {
      ...RUN_FINISHED,
      id: "r1",
      job_id: "jr1",
      state: "running",
      phase: "building",
      ended_at: null,
      version: null,
      summary: null,
      open_questions: [],
    };
    const liveModel = { ...MODEL, live_run_id: "r1" };
    const liveRoutes = (extra: unknown[] = []) => [
      ...extra,
      { method: "GET", path: /\/asset-models$/, body: { items: [liveModel] } },
      { method: "GET", path: /\/runs\/r1$/, body: LIVE },
    ];

    it("the Build bar follows a live run and Stop stops it", async () => {
      const { requests } = open(
        liveRoutes([
          {
            method: "POST",
            path: /\/runs\/r1\/stop$/,
            body: { ...LIVE, state: "stopped", stop_reason: "user", ended_at: "2026-10-02T10:00:00Z" },
          },
        ]),
      );
      const bar = await screen.findByTestId("model-build-bar");
      expect(await within(bar).findByText("Building")).toBeInTheDocument();
      expect(within(bar).getByText(/step 2 of 80/i)).toBeInTheDocument();
      expect(within(bar).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
      expect(within(bar).getByRole("img", { name: /step 2/i })).toHaveAttribute(
        "src",
        expect.stringMatching(/\/runs\/r1\/steps\/2\/thumb\?token=t$/),
      );
      fireEvent.click(within(bar).getByRole("button", { name: /^stop$/i }));
      await waitFor(() =>
        expect(requests.some((r) => r.method === "POST" && /\/runs\/r1\/stop$/.test(r.url))).toBe(true),
      );
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Stopped by you"),
      );
      expect(await within(bar).findByRole("button", { name: /build with ai/i })).toBeInTheDocument();
    });

    it("a failed stop says why and keeps the run", async () => {
      open(
        liveRoutes([
          {
            method: "POST",
            path: /\/runs\/r1\/stop$/,
            status: 500,
            body: { error: { code: "internal", message: "Boom.", details: {} } },
          },
        ]),
      );
      const bar = await screen.findByTestId("model-build-bar");
      fireEvent.click(await within(bar).findByRole("button", { name: /^stop$/i }));
      await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Boom."));
      expect(within(bar).getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    });

    it("a run that finishes says which version it built", async () => {
      open(
        liveRoutes([
          {
            method: "POST",
            path: /\/runs\/r1\/stop$/,
            body: { ...LIVE, state: "finished", phase: "done", version: 3, ended_at: "2026-10-02T10:00:00Z" },
          },
        ]),
      );
      const bar = await screen.findByTestId("model-build-bar");
      fireEvent.click(await within(bar).findByRole("button", { name: /^stop$/i }));
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Built version 3"),
      );
    });

    it("without a version, the inspector opens on the Run tab with the live run's steps", async () => {
      open(
        liveRoutes([
          {
            method: "GET",
            path: /\/asset-models$/,
            body: { items: [{ ...liveModel, current_version: null }] },
          },
          { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [] } },
        ]),
      );
      expect(await screen.findByTestId("model-run-progress")).toBeInTheDocument();
      const inspector = screen.getByTestId("model-inspector");
      expect(within(inspector).getByRole("tab", { name: /^run$/i })).toHaveAttribute("aria-selected", "true");
      const panel = within(inspector).getByRole("tabpanel", { name: /run/i });
      expect(await within(panel).findAllByRole("listitem", { name: /step/i })).toHaveLength(2);
      fireEvent.click(within(inspector).getByRole("tab", { name: /versions/i }));
      expect(within(inspector).getByRole("tabpanel", { name: /versions/i })).toHaveTextContent(
        /no versions yet/i,
      );
    });

    it("a started run whose progress can't be read shows the error, not a live run", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const providers = {
          items: [
            {
              name: "anthropic",
              model_name: "claude-opus-5-5",
              has_key: true,
              requests_per_minute: 30,
              cost_per_request: 0,
            },
          ],
        };
        open([
          { method: "GET", path: /\/providers$/, body: providers },
          {
            method: "GET",
            path: /\/drawings$/,
            body: {
              items: [
                {
                  ...pdfDrawing,
                  id: "d1",
                  name: "GA drawing",
                  source_path: "D:\\plans\\ga.pdf",
                  page: 1,
                  status: "ready",
                },
              ],
            },
          },
          { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
          {
            method: "GET",
            path: /\/data$/,
            body: {
              items: [
                {
                  id: "d1",
                  type: "drawing",
                  label: "GA drawing",
                  status: "ready",
                  captured_on: null,
                  created_at: "2026-10-01T09:00:00Z",
                  summary: {},
                },
              ],
              next_cursor: null,
            },
          },
          { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
          {
            method: "POST",
            path: /\/asset-models\/m1\/runs$/,
            status: 202,
            body: { run: LIVE, job: { id: "jr1", type: "asset_model_run", state: "queued" } },
          },
          {
            method: "GET",
            path: /\/runs\/r1$/,
            status: 500,
            body: { error: { code: "internal", message: "Boom.", details: {} } },
          },
        ]);
        const bar = await screen.findByTestId("model-build-bar");
        fireEvent.click(within(bar).getByRole("button", { name: /build with ai/i }));
        const dialog = await screen.findByRole("dialog", { name: /build with ai/i });
        fireEvent.click(await within(dialog).findByRole("checkbox", { name: /ga drawing/i }));
        await waitFor(() =>
          expect(within(dialog).getByRole("button", { name: /start build/i })).toBeEnabled(),
        );
        fireEvent.click(within(dialog).getByRole("button", { name: /start build/i }));
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(RUN_POLL_MS * 2 * RUN_POLL_MAX_FAILURES);
        });
        expect(await within(bar).findByText(/the run could not be read/i)).toBeInTheDocument();
        expect(within(bar).queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("without a version, a live run replaces the empty card with its progress", async () => {
      open(
        liveRoutes([
          {
            method: "GET",
            path: /\/asset-models$/,
            body: { items: [{ ...liveModel, current_version: null }] },
          },
          { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [] } },
        ]),
      );
      expect(await screen.findByTestId("model-run-progress")).toHaveTextContent(/step 2 of 80/i);
      expect(screen.queryByTestId("model-no-version")).not.toBeInTheDocument();
    });

    it("Build with AI… starts a run and the bar follows it", async () => {
      const providers = {
        items: [
          {
            name: "anthropic",
            model_name: "claude-opus-5-5",
            has_key: true,
            requests_per_minute: 30,
            cost_per_request: 0,
          },
        ],
      };
      const { requests } = open([
        { method: "GET", path: /\/providers$/, body: providers },
        {
          method: "GET",
          path: /\/drawings$/,
          body: {
            items: [
              {
                ...pdfDrawing,
                id: "d1",
                name: "GA drawing",
                source_path: "D:\\plans\\ga.pdf",
                page: 1,
                status: "ready",
              },
            ],
          },
        },
        { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
        {
          method: "GET",
          path: /\/data$/,
          body: {
            items: [
              {
                id: "d1",
                type: "drawing",
                label: "GA drawing",
                status: "ready",
                captured_on: null,
                created_at: "2026-10-01T09:00:00Z",
                summary: {},
              },
            ],
            next_cursor: null,
          },
        },
        { method: "GET", path: /\/images$/, body: { items: [], next_cursor: null, total: 0 } },
        {
          method: "POST",
          path: /\/asset-models\/m1\/runs$/,
          status: 202,
          body: { run: LIVE, job: { id: "jr1", type: "asset_model_run", state: "queued" } },
        },
        { method: "GET", path: /\/runs\/r1$/, body: LIVE },
      ]);
      const bar = await screen.findByTestId("model-build-bar");
      fireEvent.click(within(bar).getByRole("button", { name: /build with ai/i }));
      const dialog = await screen.findByRole("dialog", { name: /build with ai/i });
      fireEvent.click(await within(dialog).findByRole("checkbox", { name: /ga drawing/i }));
      await waitFor(() => expect(within(dialog).getByRole("button", { name: /start build/i })).toBeEnabled());
      fireEvent.click(within(dialog).getByRole("button", { name: /start build/i }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(requests.some((r) => r.method === "POST" && /\/runs$/.test(r.url))).toBe(true);
      expect(await within(bar).findByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    });

    it("after a stopped run the bar gives its reason and Try again reopens it prefilled", async () => {
      const stopped = {
        ...RUN_FINISHED,
        id: "r0",
        mode: "refine",
        state: "stopped",
        stop_reason: "budget",
        provider: "anthropic",
        model_name: "claude-opus-5-5",
        notes: "N7 is at 270°, not 90°",
        version: 3,
        started_at: "2026-10-02T11:00:00Z",
      };
      open([
        { method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [stopped, RUN] } },
        { method: "GET", path: /\/providers$/, body: { items: [] } },
      ]);
      const bar = await screen.findByTestId("model-build-bar");
      expect(await within(bar).findByText(/stopped: the run used its budget/i)).toBeInTheDocument();
      expect(within(bar).getByText(/saved a draft as version 3/i)).toBeInTheDocument();
      fireEvent.click(within(bar).getByRole("button", { name: /try again/i }));
      const dialog = await screen.findByRole("dialog", { name: /refine with ai/i });
      expect(within(dialog).getByLabelText(/notes/i)).toHaveValue("N7 is at 270°, not 90°");
      expect(within(dialog).getByLabelText(/^model$/i)).toHaveValue("claude-opus-5-5");
      expect(within(dialog).getByRole("button", { name: /start refine/i })).toBeInTheDocument();
    });

    it("a run adopted on load is followed to its end even after a reload clears live_run_id", async () => {
      // The jobs store learns of the end first: its reload clears `live_run_id` before the run poll
      // that sees the end. The screen must still toast the end exactly once (and the global job
      // toast must stay quiet).
      let ended = false;
      const job = {
        id: "jr1",
        project_id: PROJECT_ID,
        type: "asset_model_run",
        state: "running",
        params: { model_id: "m1" },
      } as unknown as Job;
      useJobsStore.getState().upsert(job);
      function GlobalToasts() {
        useJobToasts();
        return null;
      }
      const client = fakeClient(
        routes([
          {
            method: "GET",
            path: /\/asset-models$/,
            body: () => ({ items: [{ ...MODEL, live_run_id: ended ? null : "r1" }] }),
          },
          {
            method: "GET",
            path: /\/runs\/r1$/,
            body: () =>
              ended
                ? { ...LIVE, state: "finished", phase: "done", version: 3, ended_at: "2026-10-02T10:00:00Z" }
                : LIVE,
          },
        ]) as never,
      );
      renderWithProviders(
        <>
          <AssetModelWorkspace />
          <GlobalToasts />
        </>,
        { api: client.api, route: `/p/${PROJECT_ID}/models/m1`, path: "/p/:projectId/models/:modelId?" },
      );
      const bar = await screen.findByTestId("model-build-bar");
      expect(await within(bar).findByRole("button", { name: /^stop$/i })).toBeInTheDocument();
      ended = true;
      const listReads = () => client.requests.filter((r) => /\/asset-models$/.test(r.url)).length;
      const before = listReads();
      act(() => useJobsStore.getState().upsert({ ...job, state: "succeeded" }));
      await waitFor(() => expect(listReads()).toBeGreaterThan(before));
      await waitFor(
        () => expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("Built version 3"),
        { timeout: 5000 },
      );
      expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(["Built version 3"]);
    }, 10_000);

    it("without a version, the card offers Try again for a stopped run, prefilled", async () => {
      const stopped = {
        ...RUN_FINISHED,
        id: "r0",
        mode: "build",
        state: "stopped",
        stop_reason: "provider_error",
        version: null,
        notes: "Roof is a cone",
        model_name: "claude-opus-5-5",
      };
      open([
        { method: "GET", path: /\/asset-models$/, body: { items: [{ ...MODEL, current_version: null }] } },
        { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [] } },
        { method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [stopped] } },
        { method: "GET", path: /\/providers$/, body: { items: [] } },
        {
          method: "GET",
          path: /\/drawings$/,
          body: {
            items: [
              {
                ...pdfDrawing,
                id: "d1",
                name: "GA drawing",
                source_path: "D:\\plans\\ga.pdf",
                page: 1,
                status: "ready",
              },
            ],
          },
        },
        { method: "GET", path: /\/drawings\/unimported$/, body: { files: [] } },
        {
          method: "GET",
          path: /\/data$/,
          body: (req: { url: string }) => ({
            items: req.url.includes("type=drawing")
              ? [
                  {
                    id: "d1",
                    type: "drawing",
                    label: "GA drawing",
                    status: "ready",
                    captured_on: null,
                    created_at: "2026-10-01T09:00:00Z",
                    summary: {},
                  },
                ]
              : [],
            next_cursor: null,
          }),
        },
      ]);
      const card = await screen.findByTestId("model-no-version");
      expect(await within(card).findByText(/the ai provider returned an error/i)).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /try again/i })).toHaveLength(1);
      fireEvent.click(within(card).getByRole("button", { name: /try again/i }));
      const dialog = await screen.findByRole("dialog", { name: /build with ai/i });
      expect(within(dialog).getByLabelText(/notes/i)).toHaveValue("Roof is a cone");
      expect(within(dialog).getByLabelText(/^model$/i)).toHaveValue("claude-opus-5-5");
      await waitFor(() =>
        expect(within(dialog).getByRole("checkbox", { name: /ga drawing/i })).toBeChecked(),
      );
    });

    it("the Run tab shows the latest run", async () => {
      open([{ method: "GET", path: /\/asset-models\/m1\/runs$/, body: { items: [RUN] } }]);
      await screen.findByTestId("model-workspace");
      fireEvent.click(await screen.findByRole("tab", { name: /^run$/i }));
      const panel = await screen.findByRole("tabpanel", { name: /run/i });
      expect(await within(panel).findByText(RUN.summary!)).toBeInTheDocument();
    });
  });

  /** Renders the models route plus a catch-all, the probe outside `<Routes>` (it would unmount on a redirect). */
  const openRouted = (route: string, items: unknown[]) => {
    const client = fakeClient(routes([{ method: "GET", path: /\/asset-models$/, body: { items } }]) as never);
    renderWithProviders(
      <>
        <Routes>
          <Route path="/p/:projectId/models/:modelId?" element={<AssetModelWorkspace />} />
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
        <LocationProbe />
      </>,
      { api: client.api, route },
    );
    return client;
  };

  it("a plant model opens in the site view (Ruling 13)", async () => {
    openRouted(`/p/${PROJECT_ID}/models/m1`, [{ ...MODEL, kind: "plant" }]);
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/site/m1`));
  });

  it("?view=model keeps a plant in this workspace", async () => {
    openRouted(`/p/${PROJECT_ID}/models/m1?view=model`, [{ ...MODEL, kind: "plant" }]);
    expect(await screen.findByTestId("model-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1?view=model`);
  });

  it("the default pick on /models prefers an asset model, so a mixed project stays reachable", async () => {
    openRouted(`/p/${PROJECT_ID}/models`, [
      { ...MODEL, id: "plant1", kind: "plant" },
      { ...MODEL, id: "m1", kind: "asset" },
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1`),
    );
    expect(screen.getByTestId("location")).not.toHaveTextContent("/site");
  });

  it("Open in site opens this model in the site view", async () => {
    openRouted(`/p/${PROJECT_ID}/models/m1`, [MODEL]);
    fireEvent.click(await screen.findByRole("button", { name: "Open in site" }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/site/m1`);
  });
});
