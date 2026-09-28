import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { UTM38, renderInWorkspace, w3Stores } from "@/mapws/test/w3Fixtures";
import { useZonesStore } from "./store";
import { ZoneOverlay } from "./ZoneOverlay";

const ring: [number, number][] = [
  [500000, 3300000],
  [501000, 3300000],
  [501000, 3301000],
  [500000, 3300000],
];

function setup(status = 201) {
  useToastStore.getState().clear();
  const stores = w3Stores();
  stores.workspace.setState({
    viewApi: { pixelOf: () => [300, 200] } as never,
  });
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/site-areas$/,
      status,
      body: (r) =>
        status === 201
          ? { id: "z1", created_at: "2026-09-27T10:00:00Z", ...(r.body as object) }
          : errorBody("internal", "the database is locked"),
    },
  ]);
  renderInWorkspace(<ZoneOverlay projectId={PROJECT_ID} frame={UTM38} />, {
    stores,
    api,
  });
  act(() =>
    stores.tools.setState({
      completed: {
        toolId: "zone",
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    }),
  );
  return { stores, requests };
}

const toasts = () => useToastStore.getState().toasts.map((t) => [t.tone, t.text]);

describe("ZoneOverlay", () => {
  it("names and categorises the outline, saves a site area and selects it", async () => {
    const revision = useZonesStore.getState().revision;
    const { stores, requests } = setup();
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Crane exclusion" },
    });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "exclusion" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save zone" }));
    await waitFor(() =>
      expect(stores.workspace.getState().selection).toEqual({
        kind: "zone",
        id: "z1",
      }),
    );
    expect(requests[0].body).toMatchObject({
      name: "Crane exclusion",
      category: "exclusion",
    });
    expect((requests[0].body as { polygon_wgs84: number[][] }).polygon_wgs84).toHaveLength(3);
    expect(stores.tools.getState().completed).toBeNull();
    expect(useZonesStore.getState().revision).toBe(revision + 1);
    expect(toasts()).toContainEqual(["ok", "Crane exclusion saved — counts update in the background"]);
  });

  it("Cancel drops the outline and saves nothing", async () => {
    const { stores, requests } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(stores.tools.getState().completed).toBeNull();
    expect(requests).toHaveLength(0);
  });

  it("a server failure toasts danger and keeps the form for a retry", async () => {
    const { stores } = setup(500);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.click(screen.getByRole("button", { name: "Save zone" }));
    await waitFor(() => expect(toasts()).toContainEqual(["danger", "the database is locked"]));
    expect(stores.tools.getState().completed).not.toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue("Yard");
  });
});
