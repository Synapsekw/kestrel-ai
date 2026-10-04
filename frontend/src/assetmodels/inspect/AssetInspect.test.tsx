import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { exampleImage, fakeClient, personBox, PROJECT_ID } from "@/test/fixtures";
import { ASSET_FINDINGS, MODEL_REVIEWED, PLACEMENTS } from "@/test/assetFindingFixtures";
import { VERSION_2 } from "@/test/assetModelFixtures";
import { useImagesWorkspace } from "@/store/imagesWorkspace";

vi.mock("@/assetmodels/viewer/ModelViewer", async () => ({
  ModelViewer: (await import("@/test/fakeModelViewer")).FakeModelViewer,
}));
vi.mock("@/images/canvas/ImageCanvas", () => ({
  ImageCanvas: function FakeCanvas(p: { overlay?: ReactNode; topOverlay?: ReactNode }) {
    return (
      <div
        data-testid="image-canvas"
        data-has-overlay={p.topOverlay ? "yes" : "no"}
        data-old-overlay={p.overlay ? "yes" : "no"}
      />
    );
  },
}));
import { callsTo, emitState, resetFake } from "@/test/fakeModelViewer";
import { SPLIT_KEY } from "./split";
import { AssetInspect } from "./AssetInspect";

const sighting = (
  id: string,
  image_id: string,
  annotation_id: string,
  representative = false,
  captured_at = "2026-09-14T06:05:00Z",
) => ({
  id,
  captured_at,
  finding_id: "f1",
  image_id,
  annotation_id,
  severity: 2,
  group_tag: null,
  placement: "patch",
  center: [10, 12.4, -3],
  normal: [0, 0, -1],
  part: null,
  coverage: 0.01,
  placed_version: 2,
  representative,
  created_at: "2026-10-03T00:00:00Z",
});
const SIGHTINGS = [
  sighting("s1", "img-1", "b-1", true),
  sighting("s2", "img-2", "b-2", false, "2026-09-15T08:30:00Z"),
];
const pose = (image_id: string) => ({
  image_id,
  position: [30, 12, 0],
  target: [10, 12, -3],
  up: [0, 1, 0],
  hfov_deg: 70,
  vfov_deg: 52,
  source: "kit",
  accuracy_m: null,
  sequence: "A",
  outcome: "finding",
  updated_at: "2026-10-03T00:00:00Z",
});
const image = (id: string) => ({
  ...exampleImage,
  id,
  width: 4000,
  height: 3000,
  capture_time: "2026-09-14T06:05:00Z",
  camera: {},
  footprint: null,
  footprint_kind: "none",
});
const boxOn = (imageId: string, id: string) => ({
  ...personBox,
  id,
  image_id: imageId,
  points: [
    [0, 0],
    [100, 0],
    [100, 80],
  ],
});

const routes = (extra: unknown[] = []) => [
  ...extra,
  { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
  { method: "GET", path: /\/asset-models\/m1\/versions$/, body: { items: [VERSION_2] } },
  { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
  { method: "GET", path: /\/findings\/f1\/sightings$/, body: { items: SIGHTINGS } },
  { method: "GET", path: /\/findings\/f2\/sightings$/, body: { items: [] } },
  { method: "GET", path: /\/placements$/, body: PLACEMENTS },
  { method: "GET", path: /\/poses$/, body: { items: [pose("img-1"), pose("img-2")], next: null } },
  { method: "GET", path: /\/images\/img-1$/, body: image("img-1") },
  { method: "GET", path: /\/images\/img-2$/, body: image("img-2") },
  { method: "GET", path: /\/images\/img-1\/boxes$/, body: { items: [boxOn("img-1", "b-1")] } },
  { method: "GET", path: /\/images\/img-2\/boxes$/, body: { items: [boxOn("img-2", "b-2")] } },
  { method: "GET", path: /\/measurements$/, body: { items: [] } },
];

const open = (search = "?finding=f1", extra: unknown[] = []) => {
  const client = fakeClient(routes(extra) as never);
  const view = renderWithProviders(
    <>
      <AssetInspect />
      <LocationProbe />
    </>,
    {
      api: client.api,
      route: `/p/${PROJECT_ID}/models/m1/inspect${search}`,
      path: "/p/:projectId/models/:modelId/inspect",
    },
  );
  return { ...client, unmount: view.unmount };
};
const gets = (requests: { method: string; url: string }[], re: RegExp) =>
  requests.filter((r) => r.method === "GET" && re.test(r.url.split("?")[0])).length;

beforeEach(() => resetFake());
afterEach(() => {
  localStorage.clear();
  useImagesWorkspace.getState().reset();
});

describe("split inspection", () => {
  it("opens the representative sighting with its overlay, HUD and the model focused on the finding", async () => {
    open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    expect(pane).toHaveAttribute("data-overlay", "on");
    expect(screen.getByTestId("image-canvas")).toHaveAttribute("data-has-overlay", "yes");
    const hud = screen.getByTestId("inspect-hud");
    expect(hud).toHaveTextContent("F-0042");
    expect(hud).toHaveTextContent("12.4 m");
    expect(hud).toHaveTextContent("West");
    expect(hud).toHaveTextContent(/14 Sept? 2026/);
    expect(hud).toHaveTextContent("Sighting 1 of 2");
    act(() => emitState("running"));
    await waitFor(() =>
      expect(callsTo("focusFinding")).toContainEqual(["f1", { frustum: [0.05, 0.125], oblique_deg: 20 }]),
    );
    expect(callsTo("setSelectedCamera")).toContainEqual(["img-1", true]);
    expect(callsTo("setAutoRotate")).toContainEqual([false]);
  });

  it("hold to compare hides the overlay while Space is down", async () => {
    open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    fireEvent.keyDown(window, { key: " " });
    expect(pane).toHaveAttribute("data-overlay", "off");
    expect(screen.getByTestId("image-canvas")).toHaveAttribute("data-has-overlay", "no");
    fireEvent.keyUp(window, { key: " " });
    expect(pane).toHaveAttribute("data-overlay", "on");
  });

  it("arrows step the sightings and J and K step the findings", async () => {
    open();
    await screen.findByText("Sighting 1 of 2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("sighting=s2"));
    expect(await screen.findByText("Sighting 2 of 2")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f2"));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f1"));
  });

  it("the splitter is a keyboard separator and its width is remembered", async () => {
    open();
    const sep = await screen.findByRole("separator", { name: /resize the model and photo panes/i });
    sep.focus();
    fireEvent.keyDown(sep, { key: "Home" });
    expect(sep).toHaveAttribute("aria-valuenow", "22");
    expect(localStorage.getItem(SPLIT_KEY)).toBe("22");
    expect(screen.getByTestId("location")).toHaveTextContent("finding=f1"); // the arrow never reached the sightings
  });

  it("splits the current sighting off into a new finding", async () => {
    const client = open("?finding=f1", [
      {
        method: "POST",
        path: /\/findings\/f1\/split$/,
        body: { ...ASSET_FINDINGS[0], id: "f9", number: 99 },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /split off this sighting/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f9"));
    expect(client.requests.find((r) => r.method === "POST")!.body).toEqual({ sighting_ids: ["s1"] });
  });

  it("merges the finding into another one", async () => {
    const client = open("?finding=f1", [
      { method: "POST", path: /\/findings\/f1\/merge$/, body: ASSET_FINDINGS[1] },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /merge into/i }));
    const dialog = await screen.findByRole("dialog", { name: /merge f-0042/i });
    fireEvent.change(within(dialog).getByLabelText(/merge into/i), { target: { value: "f2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f2"));
    expect(client.requests.find((r) => r.method === "POST")!.body).toEqual({ into: "f2" });
  });

  it("looks from the photo's pose in the View from pose mode", async () => {
    open();
    await screen.findByTestId("inspect-photo");
    fireEvent.click(screen.getByRole("radio", { name: /view from pose/i }));
    act(() => emitState("running"));
    await waitFor(() =>
      expect(
        callsTo("viewFromPose").some((c) => (c[0] as { imageId?: string } | null)?.imageId === "img-1"),
      ).toBe(true),
    );
    expect(screen.queryByTestId("inspect-photo")).not.toBeInTheDocument();
  });

  it("says so when the finding is not on this model", async () => {
    open("?finding=nope", [
      {
        method: "GET",
        path: /\/findings\/nope$/,
        status: 404,
        body: { error: { code: "not_found", message: "no", details: {} } },
      },
    ]);
    expect(await screen.findByText(/this finding is not on this asset model/i)).toBeInTheDocument();
  });

  it("hides the photo's other annotations and keeps the overlay; tool and annotations come back after", async () => {
    useImagesWorkspace.setState({ tool: "select" });
    expect(useImagesWorkspace.getState().showAnnotations).toBe(true);
    const { unmount } = open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    expect(useImagesWorkspace.getState().showAnnotations).toBe(false);
    expect(useImagesWorkspace.getState().tool).toBe("pan");
    const canvas = screen.getByTestId("image-canvas");
    expect(canvas).toHaveAttribute("data-has-overlay", "yes"); // the top layer, not the annotations'
    expect(canvas).toHaveAttribute("data-old-overlay", "no");
    unmount();
    expect(useImagesWorkspace.getState().showAnnotations).toBe(true);
    expect(useImagesWorkspace.getState().tool).toBe("select");
  });

  it("stepping a sighting neither rebuilds the placements nor re-aims the model", async () => {
    open();
    await screen.findByText("Sighting 1 of 2");
    act(() => emitState("running"));
    await waitFor(() => expect(callsTo("focusFinding").length).toBeGreaterThan(0));
    await waitFor(() => expect(callsTo("setPlacements").at(-1)?.[0]).toHaveLength(2));
    const placed = callsTo("setPlacements").length;
    const focused = callsTo("focusFinding").length;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByText("Sighting 2 of 2")).toBeInTheDocument();
    await waitFor(() => expect(callsTo("setSelectedCamera")).toContainEqual(["img-2", true]));
    expect(callsTo("setPlacements")).toHaveLength(placed);
    expect(callsTo("focusFinding")).toHaveLength(focused);
  });

  it("reloads the findings list and the placements after a split", async () => {
    const client = open("?finding=f1", [
      {
        method: "POST",
        path: /\/findings\/f1\/split$/,
        body: { ...ASSET_FINDINGS[0], id: "f9", number: 99 },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /split off this sighting/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f9"));
    await waitFor(() => expect(gets(client.requests, /\/findings$/)).toBe(2));
    await waitFor(() => expect(gets(client.requests, /\/placements$/)).toBe(2));
  });

  it("forgets the merge target on the next finding and never offers a closed one", async () => {
    const closed = { ...ASSET_FINDINGS[1], id: "f3", number: 44, status: "closed" };
    open("?finding=f1", [
      {
        method: "GET",
        path: /\/findings$/,
        body: { items: [...ASSET_FINDINGS, closed], next_cursor: null },
      },
      { method: "POST", path: /\/findings\/f1\/merge$/, body: ASSET_FINDINGS[1] },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /merge into/i }));
    let dialog = await screen.findByRole("dialog", { name: /merge f-0042/i });
    expect(within(dialog).queryByRole("option", { name: /F-0044/ })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/merge into/i), { target: { value: "f2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("finding=f2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: /merge into/i }));
    dialog = await screen.findByRole("dialog", { name: /merge f-0043/i });
    expect(within(dialog).getByLabelText(/merge into/i)).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: /^merge$/i })).toBeDisabled();
  });

  it("offers a retry when the sightings fail to load", async () => {
    let calls = 0;
    const client = open("?finding=f1", [
      {
        method: "GET",
        path: /\/findings\/f1\/sightings$/,
        status: () => (++calls === 1 ? 500 : 200),
        body: () =>
          calls === 1
            ? { error: { code: "internal", message: "The disk is busy.", details: {} } }
            : { items: SIGHTINGS },
      },
    ]);
    const alert = await screen.findByRole("alert");
    expect(screen.queryByRole("status", { name: /loading the sightings/i })).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("inspect-photo")).toBeInTheDocument();
    expect(gets(client.requests, /\/findings\/f1\/sightings$/)).toBe(2);
  });

  it("an error fetching an unlisted finding is not a missing finding", async () => {
    open("?finding=nope", [
      {
        method: "GET",
        path: /\/findings\/nope$/,
        status: 500,
        body: { error: { code: "internal", message: "The disk is busy.", details: {} } },
      },
    ]);
    const message = await screen.findByText("The disk is busy.");
    const alert = message.closest<HTMLElement>('[role="alert"]')!;
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/this finding is not on this asset model/i)).not.toBeInTheDocument();
  });

  it("stops comparing when the pane leaves Photo mode with Space held", async () => {
    open();
    const pane = await screen.findByTestId("inspect-photo");
    await waitFor(() => expect(pane).toHaveAttribute("data-rings", "1"));
    fireEvent.keyDown(window, { key: " " });
    expect(pane).toHaveAttribute("data-overlay", "off");
    fireEvent.click(screen.getByRole("radio", { name: /^model$/i }));
    fireEvent.click(screen.getByRole("radio", { name: /^photo$/i }));
    expect(await screen.findByTestId("inspect-photo")).toHaveAttribute("data-overlay", "on");
  });

  it("reads the capture time from the sighting, also outside Photo mode, and the side as a word", async () => {
    open();
    await screen.findByText("Sighting 1 of 2");
    fireEvent.click(screen.getByRole("radio", { name: /^model$/i }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const hud = await screen.findByTestId("inspect-hud");
    await waitFor(() => expect(hud).toHaveTextContent(/15 Sept? 2026/));
    expect(hud).toHaveTextContent("West");
  });
});
