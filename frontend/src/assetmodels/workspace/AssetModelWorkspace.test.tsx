import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL, RUN, SPEC_V1, SPEC_V2, VERSION_1, VERSION_2 } from "@/test/assetModelFixtures";
import { useToastStore } from "@/ui";

vi.mock("@/assetmodels/viewer/ModelViewer", async () => ({
  ModelViewer: (await import("@/test/fakeModelViewer")).FakeModelViewer,
}));
import { callsTo, emitParts, emitState, resetFake } from "@/test/fakeModelViewer";
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

const open = (extra: unknown[] = []) => {
  const client = fakeClient(routes(extra) as never);
  renderWithProviders(<AssetModelWorkspace />, {
    api: client.api,
    route: `/p/${PROJECT_ID}/models/m1`,
    path: "/p/:projectId/models/:modelId",
  });
  return client;
};

describe("AssetModelWorkspace", () => {
  beforeEach(() => {
    resetFake();
    useToastStore.getState().clear();
  });
  afterEach(() => vi.unstubAllGlobals());

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

  it("downloads the spec as JSON named after the model and version", async () => {
    const saved = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => "blob:spec");
    URL.revokeObjectURL = vi.fn();
    const clicked: { href: string; download: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
    });
    open();
    await screen.findByTestId("fake-model-viewer");
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: /spec \(json\)/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("menuitem", { name: /spec \(json\)/i }));
    expect(clicked).toEqual([{ href: "blob:spec", download: "Feed tank T-101-v2.json" }]);
    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /3d model \(glb\)/i }));
    expect(clicked[1].download).toBe("Feed tank T-101-v2.glb");
    expect(clicked[1].href).toMatch(/\/asset-models\/m1\/versions\/2\/glb\?token=t$/);
    click.mockRestore();
    // The blob URL is released on the next turn; let that run before the stubs go.
    await new Promise((r) => setTimeout(r, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:spec");
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  });
});
