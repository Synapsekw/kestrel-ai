import { useRef, useState, type RefObject } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { imageJumpHref } from "@/clouds/jump";
import { photosSeeing } from "@/clouds/photoLink";
import { useToastStore } from "@/ui";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { exampleImage, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { PhotoLinkTool } from "./PhotoLinkTool";
import { useCamerasStore } from "./store";

const E = 243550;
const N = 3178050;
const PICK = { x: E, y: N, z: 1 };
type Picked = { point: [number, number, number]; u: number; normal: [number, number, number] | null };
type FakeViewer = { pickWithNormal: ReturnType<typeof vi.fn> };
const SET = cameraSet([
  { id: "img-nadir", x: E, y: N, z: 30, yaw: 0, pitch: -90 },
  { id: "img-plain", x: E + 10, y: N, z: 30 },
]);

/** Wraps the tool with a real `active` state so a test can flip it without remounting the providers. */
function Harness({ initialActive, v }: { initialActive: boolean; v: FakeViewer }) {
  const [active, setActive] = useState(initialActive);
  const ref = useRef<CloudViewerHandle | null>(
    v as unknown as CloudViewerHandle,
  ) as RefObject<CloudViewerHandle | null>;
  return (
    <>
      <canvas data-testid="cloud-canvas" />
      <button type="button" data-testid="toggle-active" onClick={() => setActive((a) => !a)} />
      <PhotoLinkTool projectId={PROJECT_ID} cloud={exampleCloud} viewer={ref} active={active} />
      <LocationProbe />
    </>
  );
}

function mount(opts: { active?: boolean; miss?: boolean; normal?: [number, number, number] | null } = {}) {
  const picked: Picked = { point: [PICK.x, PICK.y, PICK.z], u: 0.05, normal: opts.normal ?? null };
  const v: FakeViewer = { pickWithNormal: vi.fn(() => (opts.miss ? null : picked)) };
  const { api } = fakeClient([{ method: "GET", path: /\/images\/[^/]+$/, body: exampleImage }]);
  renderWithProviders(<Harness initialActive={opts.active ?? true} v={v} />, {
    api,
    route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
  });
  return v;
}

function click(x = 400, y = 300) {
  const canvas = screen.getByTestId("cloud-canvas");
  canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y, button: 0, bubbles: true }));
}

const toasts = () => useToastStore.getState().toasts.map((t) => t.text);

beforeEach(() => {
  useToastStore.getState().clear();
  const s = useCamerasStore.getState();
  s.reset(CLOUD_ID);
  s.receive(CLOUD_ID, SET);
});
afterEach(() => useCamerasStore.getState().reset(null));

describe("PhotoLinkTool", () => {
  it("lists the photos that saw the point, with their method, and toasts the closest", async () => {
    mount();
    click();
    const list = await screen.findByRole("list", { name: "Photos that saw this point" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("In frame");
    expect(items[0]).toHaveTextContent("29.0 m");
    expect(items[1]).toHaveTextContent("By distance");
    await waitFor(() =>
      expect(toasts()).toContain(`2 photos saw this point · ${exampleImage.file_name} closest (29.0 m)`),
    );
  });

  it("a click on a frustum hit opens the image at the spot", async () => {
    mount();
    click();
    const hit = photosSeeing(PICK, null, SET).hits[0];
    fireEvent.click(await screen.findByRole("button", { name: /^Open photo 1/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        imageJumpHref(PROJECT_ID, "img-nadir", CLOUD_ID, { px: hit.px!, py: hit.py!, rpx: hit.rpx! }),
      ),
    );
  });

  it("a click on a distance hit opens the image without a spot", async () => {
    mount();
    click();
    fireEvent.click(await screen.findByRole("button", { name: /^Open photo 2/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        imageJumpHref(PROJECT_ID, "img-plain", CLOUD_ID, null),
      ),
    );
  });

  it("picks with the normal at the click pixel", () => {
    const v = mount();
    click(410, 320);
    expect(v.pickWithNormal).toHaveBeenCalledWith(410, 320);
  });

  it("an upward normal keeps the cameras above (the facing test passes them)", async () => {
    mount({ normal: [0, 0, 1] });
    click();
    const list = await screen.findByRole("list", { name: "Photos that saw this point" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
  });

  it("a normal facing away from the cameras removes them (the facing test)", async () => {
    mount({ normal: [0, 0, -1] }); // the surface faces down, away from both cameras
    click();
    await waitFor(() => expect(toasts()).toContain("No photo saw this point"));
  });

  it("says so when the click misses the cloud", () => {
    mount({ miss: true });
    click();
    expect(toasts()).toContain("No point under the cursor; click on the cloud");
    expect(screen.queryByRole("list", { name: "Photos that saw this point" })).toBeNull();
  });

  it("states the reason when the cameras cannot be placed", () => {
    useCamerasStore.getState().fail(CLOUD_ID, "needs_coordinates", null);
    mount();
    click();
    expect(toasts()).toContain("Assign a CRS to place the drone photos");
  });

  it("ignores clicks while the tool is not armed", () => {
    mount({ active: false });
    click();
    expect(toasts()).toEqual([]);
  });

  it("clears the list when the tool stops being active, so re-arming shows no old list", async () => {
    mount();
    click();
    await screen.findByRole("list", { name: "Photos that saw this point" });

    fireEvent.click(screen.getByTestId("toggle-active")); // disarm
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Photos that saw this point" })).toBeNull(),
    );

    fireEvent.click(screen.getByTestId("toggle-active")); // re-arm
    expect(screen.queryByRole("list", { name: "Photos that saw this point" })).toBeNull();
  });
});
