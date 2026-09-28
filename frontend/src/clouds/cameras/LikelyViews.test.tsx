import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imageJumpHref } from "@/clouds/jump";
import { photosSeeing } from "@/clouds/photoLink";
import { cameraSet } from "@/test/cameraFixtures";
import { CLOUD_ID } from "@/test/cloudFixtures";
import { exampleImage, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { useChangesStore } from "@/store/changes";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { spotOf } from "./cameraMath";
import { absoluteImagePath, LikelyViews } from "./LikelyViews";
import { useCamerasStore } from "./store";

const E = 243550;
const N = 3178050;
const FINDING = "f0000000-9999-4000-8000-000000000001";
const POINT: [number, number, number] = [E, N, 1];

const SET = cameraSet(
  Array.from({ length: 8 }, (_, i) => ({ id: `img-${i}`, x: E + i, y: N, z: 30, yaw: 0, pitch: -90 })),
);

function mount(props: { findingId?: string; limit?: number; normal?: [number, number, number] | null } = {}) {
  const client = fakeClient([
    { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
    {
      method: "GET",
      path: new RegExp(`/projects/${PROJECT_ID}$`),
      body: { ...exampleProject, folder: "D:\\Projects\\Chimney" },
    },
    { method: "POST", path: /\/attachments$/, status: 201, body: { id: "a1" } },
  ]);
  renderWithProviders(
    <>
      <LikelyViews
        point={[E, N, 1]}
        normal={props.normal ?? null}
        findingId={props.findingId}
        limit={props.limit}
      />
      <LocationProbe />
    </>,
    { api: client.api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, path: "/p/:projectId/*" },
  );
  return client;
}

beforeEach(() => {
  const s = useCamerasStore.getState();
  s.reset(CLOUD_ID);
  s.receive(CLOUD_ID, SET);
});
afterEach(() => useCamerasStore.getState().reset(null));

describe("LikelyViews", () => {
  it("shows the ranked hits up to the limit and states the full count", () => {
    mount({ limit: 2 });
    expect(screen.getByText("Likely views · seen in 8 photos")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Open photo/ })).toHaveLength(2);
    expect(screen.getAllByText("In frame")).toHaveLength(2);
  });

  it("opens the image at the spot", async () => {
    mount({ limit: 1 });
    const hit = photosSeeing({ x: POINT[0], y: POINT[1], z: POINT[2] }, null, SET).hits[0];
    fireEvent.click(screen.getByRole("button", { name: /^Open photo 1/ }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        imageJumpHref(PROJECT_ID, hit.imageId, CLOUD_ID, spotOf(hit)),
      ),
    );
  });

  it("offers Attach only for a finding, and attaches the project image by its absolute path", async () => {
    const before = useChangesStore.getState().findingsRevision;
    const { requests } = mount({ findingId: FINDING, limit: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Attach photo 1" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.url).toBe(`/api/v1/projects/${PROJECT_ID}/findings/${FINDING}/attachments`);
    expect(post.body).toEqual({ path: `D:/Projects/Chimney/${exampleImage.path}` });
    await waitFor(() => expect(useChangesStore.getState().findingsRevision).toBe(before + 1));
  });

  it("has no Attach without a finding", () => {
    mount({ limit: 1 });
    expect(screen.queryByRole("button", { name: /^Attach/ })).toBeNull();
  });

  it("states the reason when the cameras cannot be placed", () => {
    useCamerasStore.getState().fail(CLOUD_ID, "needs_coordinates", null);
    mount();
    expect(screen.getByText("Assign a CRS to place the drone photos")).toBeInTheDocument();
  });

  it("says so when no photo saw the point", () => {
    mount({ normal: [0, 0, -1] });
    expect(screen.getByText("No photo saw this point")).toBeInTheDocument();
  });

  it("joins a project folder and a relative image path with forward slashes", () => {
    expect(absoluteImagePath("D:\\Projects\\Chimney\\", "images/a/b.jpg")).toBe(
      "D:/Projects/Chimney/images/a/b.jpg",
    );
    expect(absoluteImagePath("\\\\NAS\\work", "images/c.jpg")).toBe("//NAS/work/images/c.jpg");
  });
});
