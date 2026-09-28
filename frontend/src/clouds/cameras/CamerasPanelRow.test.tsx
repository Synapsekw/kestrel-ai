import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cameraSet, SOURCE_A } from "@/test/cameraFixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useToastStore } from "@/ui";
import { CamerasPanelRow, OFFSET_SAVE_MS, parseOffsetInput } from "./CamerasPanelRow";
import { useCamerasStore } from "./store";

const E = 243550;
const N = 3178050;
const cloud = exampleCloud; // z_stats.p50 = -40.1, p99 = 170

function load(
  set = cameraSet([
    { x: E, y: N, z: 30, yaw: 0, pitch: -90 },
    { x: E, y: N, z: 32 },
    { x: E, y: N, z: 31 },
  ]),
) {
  const s = useCamerasStore.getState();
  s.reset(CLOUD_ID);
  s.receive(CLOUD_ID, set);
}

function mount() {
  const offset = { id: SOURCE_A, label: "Flight 14 Sep", count: 3, height_offset_m: 0, posed_count: 1 };
  const client = fakeClient([
    { method: "PUT", path: /\/cameras\/offsets\//, body: (req) => ({ ...offset, ...(req.body as object) }) },
  ]);
  renderWithProviders(<CamerasPanelRow projectId={PROJECT_ID} cloud={cloud} />, { api: client.api });
  return client;
}

const puts = (requests: { method: string }[]) => requests.filter((r) => r.method === "PUT");

beforeEach(() => load());
afterEach(() => useCamerasStore.getState().reset(null));

describe("CamerasPanelRow", () => {
  it("states the photos, those with angles, and those without GPS", () => {
    load(
      cameraSet(
        [
          { x: E, y: N, z: 30, yaw: 0, pitch: -90 },
          { x: E, y: N, z: 32 },
        ],
        { without_gps: 12 },
      ),
    );
    mount();
    expect(screen.getByRole("switch", { name: "Show camera positions" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("2 photos · 1 with angles")).toBeInTheDocument();
    expect(screen.getByText("12 photos without GPS")).toBeInTheDocument();
  });

  it("disables the switch with the reason when the cloud has no CRS", () => {
    useCamerasStore.getState().fail(CLOUD_ID, "needs_coordinates", null);
    mount();
    expect(screen.getByRole("switch", { name: "Show camera positions" })).toBeDisabled();
    expect(screen.getByTestId("cameras-reason")).toHaveTextContent("Assign a CRS to place the drone photos");
  });

  it("disables the switch when no photo is near the cloud", () => {
    load(cameraSet([]));
    mount();
    expect(screen.getByRole("switch", { name: "Show camera positions" })).toBeDisabled();
    expect(screen.getByTestId("cameras-reason")).toHaveTextContent("No photos near this cloud");
  });

  it("warns when the cameras sit below the cloud's median height", () => {
    load(
      cameraSet([
        { x: E, y: N, z: -60 },
        { x: E, y: N, z: -55 },
      ]),
    );
    mount();
    expect(screen.getByText("Camera heights look off; set a height offset")).toBeInTheDocument();
  });

  it("hides the offsets and the glyphs when switched off", () => {
    mount();
    fireEvent.click(screen.getByRole("switch", { name: "Show camera positions" }));
    expect(useCamerasStore.getState().visible).toBe(false);
    expect(screen.queryByRole("group", { name: /Height offset/ })).toBeNull();
  });

  it("nudges preview at once and sends one PUT after the pause, with no refetch of its own", async () => {
    const { requests } = mount();
    const raise = screen.getByRole("button", { name: "Raise Flight 14 Sep by 1 m" });
    fireEvent.click(raise);
    fireEvent.click(raise);
    fireEvent.click(raise);
    expect(useCamerasStore.getState().set!.z).toEqual([33, 35, 34]);
    expect(puts(requests)).toHaveLength(0);
    await waitFor(() => expect(puts(requests)).toHaveLength(1), { timeout: OFFSET_SAVE_MS * 5 });
    expect(puts(requests)[0]).toMatchObject({ body: { height_offset_m: 3 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(useCamerasStore.getState().reloadTick).toBe(0); // the refetch comes from pointclouds.changed
  });

  it("a failed save toasts, asks for a refetch, and the input then shows the server's value", async () => {
    const client = fakeClient([
      {
        method: "PUT",
        path: /\/cameras\/offsets\//,
        status: 422,
        body: errorBody("validation_error", "out of range"),
      },
    ]);
    renderWithProviders(<CamerasPanelRow projectId={PROJECT_ID} cloud={cloud} />, { api: client.api });
    fireEvent.click(screen.getByRole("button", { name: "Raise Flight 14 Sep by 1 m" }));
    await waitFor(() => expect(useCamerasStore.getState().reloadTick).toBe(1), {
      timeout: OFFSET_SAVE_MS * 5,
    });
    expect(useToastStore.getState().toasts.map((t) => t.text)).toContain("out of range");
    const input = screen.getByRole("spinbutton", { name: "Height offset for Flight 14 Sep in metres" });
    expect(input).toHaveValue(1); // the unsaved preview, until the refetch answers

    // the reloaded payload: the server still has 0 m (final review I3)
    act(() =>
      useCamerasStore.getState().receive(
        CLOUD_ID,
        cameraSet([
          { x: E, y: N, z: 30, yaw: 0, pitch: -90 },
          { x: E, y: N, z: 32 },
          { x: E, y: N, z: 31 },
        ]),
      ),
    );
    expect(input).toBeInTheDocument(); // the same row, not a remount
    expect(input).toHaveValue(0);
    // and the next nudge starts from the server's value, not the unsaved one
    fireEvent.click(screen.getByRole("button", { name: "Raise Flight 14 Sep by 1 m" }));
    expect(input).toHaveValue(1);
  });

  // jsdom sanitises an invalid `type="number"` value to "" before onChange ever sees it, so a
  // fireEvent with "-" cannot actually exercise the "-" branch of the guard through the DOM (it
  // arrives as ""). This test only claims what the DOM path proves: empty text is not saved. The
  // "-" (and other not-yet-a-number text) guard is proven separately below, against the real
  // string, by calling the parser directly.
  it("typing sends one PUT after the pause, and empty text is not saved", async () => {
    const { requests } = mount();
    const input = screen.getByRole("spinbutton", { name: "Height offset for Flight 14 Sep in metres" });
    fireEvent.change(input, { target: { value: "-" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(useCamerasStore.getState().set!.sources[0].height_offset_m).toBe(0);
    fireEvent.change(input, { target: { value: "-612" } });
    await waitFor(() => expect(puts(requests)).toHaveLength(1), { timeout: OFFSET_SAVE_MS * 5 });
    expect(puts(requests)[0]).toMatchObject({ body: { height_offset_m: -500 } });
    act(() => {
      fireEvent.blur(input);
    });
    expect(input).toHaveValue(-500);
  });

  it("parseOffsetInput treats intermediate text as not-yet-a-number, real minus sign included", () => {
    expect(parseOffsetInput("-")).toBeNull();
    expect(parseOffsetInput("")).toBeNull();
    expect(parseOffsetInput("1.")).toBeNull();
    expect(parseOffsetInput("-612")).toBe(-612);
    expect(parseOffsetInput("12.5")).toBe(12.5);
  });
});
