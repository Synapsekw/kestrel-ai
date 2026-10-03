import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetItem } from "@/api/plantItems";
import { renderWithDataRouter } from "@/test/dataRouter";
import { errorBody, fakeClient } from "@/test/fixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { CATALOGUE, ITEM, plantSpec } from "@/test/plantFixtures";
import { useJobsStore } from "@/store/jobs";
import { ItemEditor } from "./ItemEditor";

const JOB = {
  id: "j1",
  project_id: "p",
  type: "asset_model_glb",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-10-03T09:00:00Z",
  started_at: null,
  finished_at: null,
};
function setup(
  post: { status?: number; body: unknown } = {
    status: 201,
    body: { version: { ...VERSION_2, version: 4 }, job: JOB },
  },
  item: AssetItem = ITEM,
) {
  const client = fakeClient([
    {
      method: "GET",
      path: /\/asset-models\/m1\/versions\/3$/,
      body: { ...VERSION_2, version: 3, spec: plantSpec([item]), warnings: [] },
    },
    { method: "POST", path: /\/asset-models\/m1\/versions$/, status: post.status, body: post.body },
  ] as never);
  const props = { onSaved: vi.fn(), onCancel: vi.fn(), onDirty: vi.fn() };
  renderWithDataRouter(
    <ItemEditor projectId="p" modelId="m1" baseVersion={3} item={item} catalogue={CATALOGUE} {...props} />,
    { api: client.api },
  );
  return { ...client, ...props };
}

describe("ItemEditor", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("says which version it edits from", () => {
    setup();
    expect(screen.getByText(/editing from version/i)).toHaveTextContent("Editing from version 3");
  });

  it("saves an edited top EL as a new manual version and hands over the GLB job", async () => {
    const { requests, onSaved, onDirty } = setup();
    expect(onDirty).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    expect(onDirty).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(4, "j1"));
    const gets = requests.filter((r) => r.method === "GET");
    expect(gets).toHaveLength(1);
    const post = requests.find((r) => r.method === "POST")!.body as {
      spec: { items: { id: string; top_el: number }[] };
      note: string;
    };
    expect(post.spec.items.find((i) => i.id === "20-T-0001")!.top_el).toBe(140);
    expect(post.note).toBe("Edited 20-T-0001 from v3: top EL 135 → 140 m");
    expect(useJobsStore.getState().jobs.j1).toBeDefined();
  });

  it("an untouched form cannot be saved", () => {
    setup();
    expect(screen.getByRole("button", { name: "Save as new version" })).toBeDisabled();
  });

  it("blocks a save that breaks a rule and says why", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "90" } });
    expect(screen.getByText("Top EL must be at or above base EL.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as new version" })).toBeDisabled();
  });

  it("draws the type's params from its schema", () => {
    setup();
    expect(screen.getByLabelText(/^d m$/i)).toHaveValue(80); // "D" with its unit; the footprint's is "Diameter m"
    expect(screen.getByLabelText(/^roof/i)).toHaveValue("dome");
    expect(screen.getByRole("switch", { name: "Platforms" })).toHaveAttribute("aria-checked", "true");
  });

  it("a new type says the old params go", () => {
    setup();
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "other" } });
    expect(screen.getByText(/start from the new type's defaults/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^roof/i)).toBeNull();
  });

  it("a hand-typed EL on a scan height saves as a drawing height and says so", async () => {
    const { requests, onSaved } = setup(undefined, { ...ITEM, height_source: "cloud" } as AssetItem);
    expect(screen.getByLabelText(/^height source/i)).toHaveValue("cloud");
    expect(screen.queryByText(/set by hand/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "140" } });
    expect(screen.getByLabelText(/^height source/i)).toHaveValue("drawing");
    expect(screen.getByText("Set by hand. The scan check will keep it.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST")!.body as {
      spec: { items: { height_source: string }[] };
      note: string;
    };
    expect(post.spec.items[0].height_source).toBe("drawing");
    expect(post.note).toBe("Edited 20-T-0001 from v3: top EL 135 → 140 m, height source cloud → drawing");
  });

  it("a failed save says why and keeps the edit", async () => {
    const { onSaved } = setup({
      status: 422,
      body: errorBody("invalid_spec", "items[0].top_el: below base_el"),
    });
    fireEvent.change(screen.getByLabelText(/^top el/i), { target: { value: "141" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as new version" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("items[0].top_el: below base_el");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^top el/i)).toHaveValue(141);
  });

  it("Cancel hands back", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
