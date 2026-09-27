import { fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { exampleCloud } from "@/test/cloudFixtures";
import { callsTo, emitFrame, fake, FakeCloudViewer, resetFake } from "@/test/fakeCloudViewer";
import { exampleGeoMap, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Minimap } from "./SiteMinimap";

function Harness({
  map = null,
  onRecentre = vi.fn(),
}: {
  map?: typeof exampleGeoMap | null;
  onRecentre?: (x: number, y: number) => void;
}) {
  const viewer = useRef<CloudViewerHandle>(null);
  return (
    <>
      <FakeCloudViewer
        ref={viewer}
        cloud={exampleCloud}
        octreeUrl=""
        token=""
        budget={1}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
      />
      <Minimap
        projectId={PROJECT_ID}
        cloud={exampleCloud}
        map={map}
        viewer={viewer}
        running
        marks={[{ kind: "dot", x: 243500, y: 3178200, colour: "#ff5a4f", label: "F-0031" }]}
        clipBox={{ centre: [243500, 3178200, 0], size: [40, 20, 50], yaw_deg: 0, mode: "show_inside" }}
        onRecentre={onRecentre}
      />
    </>
  );
}

beforeEach(() => resetFake());

describe("the minimap (spec §6, C11)", () => {
  it("says its source: a linked ortho, or the cloud's own top view", () => {
    const map = {
      ...exampleGeoMap,
      proj4: exampleCloud.proj4,
      epsg: exampleCloud.epsg,
      geotransform: [243200, 1, 0, 3178600, 0, -1],
      width: 700,
      height: 700,
      captured_on: "2026-09-14",
    };
    const { unmount } = renderWithProviders(<Harness map={map} />, { api: fakeClient([]).api });
    expect(screen.getByTestId("cloud-minimap")).toHaveTextContent("Ortho · 14 Sep");
    expect(screen.getByTestId("cloud-minimap").querySelector("image")).not.toBeNull();
    unmount();
    renderWithProviders(<Harness />, { api: fakeClient([]).api });
    expect(screen.getByTestId("cloud-minimap")).toHaveTextContent("Cloud · top view");
  });

  it("draws finding dots, the clip footprint and the camera cone", () => {
    renderWithProviders(<Harness />, { api: fakeClient([]).api });
    const mini = screen.getByTestId("cloud-minimap");
    expect(mini.querySelector("title")?.textContent).toBe("F-0031");
    expect(mini.querySelector('[data-mark="clip"]')).not.toBeNull();
    emitFrame({ position: [243500, 3178100, 80], direction: [0, 1, -0.3] });
    expect(mini.querySelector('[data-mark="cone"]')?.getAttribute("visibility")).toBe("visible");
    emitFrame({ direction: [0, 0, -1] });
    expect(mini.querySelector('[data-mark="cone"]')?.getAttribute("visibility")).toBe("hidden");
  });

  it("asks for one 512 px top snapshot at the first settled frame when no map is linked", () => {
    renderWithProviders(<Harness />, { api: fakeClient([]).api });
    expect(fake.frames.size).toBe(2); // the camera cone and the snapshot watcher
    // The fake's stats say settled: the first frame asks, the second (same tick) does not ask again.
    emitFrame();
    emitFrame();
    expect(callsTo("topSnapshot")).toEqual([[512]]);
    expect(screen.getByTestId("cloud-minimap")).toHaveTextContent("Cloud · top view");
  });

  it("recentres the view on a click", () => {
    const onRecentre = vi.fn();
    renderWithProviders(<Harness onRecentre={onRecentre} />, { api: fakeClient([]).api });
    const svg = screen.getByRole("img", { name: /Site map/ });
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 330, 178));
    fireEvent.click(svg, { clientX: 165, clientY: 89 });
    const [x, y] = onRecentre.mock.lastCall!;
    const b = exampleCloud.bounds_native!;
    expect(x).toBeCloseTo((b[0] + b[3]) / 2, 0);
    expect(y).toBeCloseTo((b[1] + b[4]) / 2, 0);
  });
});
