import { useEffect } from "react";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PointCloud } from "@/api/clouds";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { MeasurePanel } from "./MeasurePanel";
import { useMeasureTool, type MeasureTool } from "./useMeasureTool";

const saved = {
  id: "m1",
  point_cloud_id: CLOUD_ID,
  kind: "distance",
  name: "Distance 1",
  note: null,
  points: [
    { x: 0, y: 0, z: 0, uncertainty_m: 0.03 },
    { x: 3, y: 4, z: 12, uncertainty_m: 0.04 },
  ],
  results: { distance_3d: 13, uncertainty_m: 0.05 },
  created_at: "2026-09-24T10:00:00Z",
  updated_at: "2026-09-24T10:00:00Z",
};

/** The screen's wiring in miniature: one tool state shared by the panel and the test. */
function Harness({ cloud, onTool }: { cloud: PointCloud; onTool(t: MeasureTool): void }) {
  const tool = useMeasureTool();
  useEffect(() => {
    onTool(tool);
  });
  return <MeasurePanel projectId={PROJECT_ID} cloud={cloud} tool={tool} onFlyTo={vi.fn()} />;
}

describe("Measure panel", () => {
  it("measures a distance live and saves it", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/measurements$/, body: { items: [] } },
      { method: "POST", path: /\/measurements$/, status: 201, body: saved },
    ]);
    let tool: MeasureTool | null = null;
    renderWithProviders(<Harness cloud={exampleCloud} onTool={(t) => (tool = t)} />, { api });
    act(() => tool!.arm("distance"));
    act(() => tool!.add({ x: 0, y: 0, z: 0, level: 5, uncertainty_m: 0.03 }));
    act(() => tool!.add({ x: 3, y: 4, z: 12, level: 5, uncertainty_m: 0.04 }));
    expect(screen.getByText("13.000 m")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const post = requests.find((r) => r.method === "POST");
    expect(post?.body).toEqual({
      kind: "distance",
      points: [
        { x: 0, y: 0, z: 0, uncertainty_m: 0.03 },
        { x: 3, y: 4, z: 12, uncertainty_m: 0.04 },
      ],
    });
    expect(await screen.findByRole("textbox", { name: "Name of Distance 1" })).toHaveValue("Distance 1");
  });

  it("says why distances are off on a cloud in degrees", () => {
    const { api } = fakeClient([{ method: "GET", path: /\/measurements$/, body: { items: [] } }]);
    const geographic = { ...exampleCloud, proj4: "+proj=longlat +datum=WGS84 +no_defs" };
    renderWithProviders(<Harness cloud={geographic} onTool={() => undefined} />, { api });
    expect(
      screen.getByText("distances need a projected coordinate system; this cloud is in degrees"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distance" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Point" })).toBeEnabled();
  });
});
