import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Job, Project } from "@contract/client";
import { exampleGeoMap, exampleProject, fakeClient, MAP_ID, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { MoveMapDialog } from "./MoveMapDialog";

const NORTH: Project = {
  ...exampleProject,
  id: "d0000000-1111-4000-8000-000000000002",
  name: "North site",
  kind: "detect",
  classes: [],
};
const SOUTH: Project = {
  ...exampleProject,
  id: "d0000000-1111-4000-8000-000000000003",
  name: "South yard",
  kind: "detect",
  classes: [],
};
const TRAIN_OTHER: Project = {
  ...exampleProject,
  id: "t0000000-1111-4000-8000-000000000004",
  name: "Other training",
};

const moveJob = (projectId: string, state: Job["state"] = "running"): Job => ({
  ...runningJob,
  id: "j0000000-4444-4000-8000-00000000mmmm",
  project_id: projectId,
  type: "map_move",
  state,
  progress: state === "succeeded" ? 1 : 0.3,
  message: state === "succeeded" ? "Copied" : "Copying tiles",
  error: null,
});

function renderDialog(routes: Parameters<typeof fakeClient>[0]) {
  const client = fakeClient(routes);
  renderWithProviders(<MoveMapDialog projectId={PROJECT_ID} geoMap={exampleGeoMap} onClose={() => {}} />, {
    api: client.api,
  });
  return client;
}

describe("MoveMapDialog", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("offers only detection projects, plus a new one", async () => {
    renderDialog([
      {
        method: "GET",
        path: /\/projects$/,
        body: { items: [exampleProject, NORTH, TRAIN_OTHER, SOUTH], next_cursor: null },
      },
    ]);
    const select = await screen.findByLabelText("Detection project");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["North site", "South yard", "New detection project…"]);
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("moves into an existing detection project and offers to open it", async () => {
    const { requests } = renderDialog([
      { method: "GET", path: /\/projects$/, body: { items: [NORTH], next_cursor: null } },
      { method: "POST", path: /\/move$/, status: 202, body: { job: moveJob(NORTH.id) } },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: moveJob(NORTH.id, "succeeded") },
    ]);
    await screen.findByRole("option", { name: "North site" });
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(await screen.findByRole("link", { name: "Open North site" })).toHaveAttribute(
      "href",
      `/p/${NORTH.id}/maps/${MAP_ID}`,
    );
    const move = requests.find((r) => r.url.endsWith("/move"));
    expect(move).toMatchObject({
      url: `/api/v1/projects/${PROJECT_ID}/maps/${MAP_ID}/move`,
      body: { target_project_id: NORTH.id },
    });
    expect(requests.some((r) => r.url === `/api/v1/projects/${NORTH.id}/jobs/${moveJob(NORTH.id).id}`)).toBe(
      true,
    );
    expect(requests.some((r) => r.method === "POST" && r.url === "/api/v1/projects")).toBe(false);
  });

  it("creates a new detection project first, then moves the map into it", async () => {
    const { requests } = renderDialog([
      { method: "GET", path: /\/projects$/, body: { items: [exampleProject], next_cursor: null } },
      { method: "POST", path: /\/projects$/, status: 201, body: NORTH },
      { method: "POST", path: /\/move$/, status: 202, body: { job: moveJob(NORTH.id) } },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: moveJob(NORTH.id, "succeeded") },
    ]);
    // No detection project yet: the new one is the only choice and its fields show.
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "North site" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:/Projects/North" } });
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(await screen.findByRole("link", { name: "Open North site" })).toBeInTheDocument();
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.url)).toEqual([
      "/api/v1/projects",
      `/api/v1/projects/${PROJECT_ID}/maps/${MAP_ID}/move`,
    ]);
    expect(posts[0].body).toEqual({
      name: "North site",
      folder: "E:/Projects/North",
      kind: "detect",
      classes: [],
    });
    expect(posts[1].body).toEqual({ target_project_id: NORTH.id });
  });

  it("retries into the project it already created when starting the move fails", async () => {
    // The first move request fails with a server error; the second one starts the job.
    let moves = 0;
    const firstMove = /\/move$/;
    const failOnce = Object.assign(/\/move$/, { test: (s: string) => firstMove.test(s) && moves++ === 0 });
    const { requests } = renderDialog([
      { method: "GET", path: /\/projects$/, body: { items: [], next_cursor: null } },
      { method: "POST", path: /\/projects$/, status: 201, body: NORTH },
      {
        method: "POST",
        path: failOnce,
        status: 500,
        body: { error: { code: "internal", message: "disk busy" } },
      },
      { method: "POST", path: /\/move$/, status: 202, body: { job: moveJob(NORTH.id) } },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: moveJob(NORTH.id, "succeeded") },
    ]);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "North site" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:/Projects/North" } });
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(await screen.findByText(/disk busy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(await screen.findByRole("link", { name: "Open North site" })).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST" && r.url === "/api/v1/projects")).toHaveLength(1);
  });

  it("asks for a name and a folder before creating a project", async () => {
    const { requests } = renderDialog([
      { method: "GET", path: /\/projects$/, body: { items: [], next_cursor: null } },
    ]);
    await screen.findByLabelText("Name");
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(
      await screen.findByText("Name the new detection project and choose its folder."),
    ).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("says why the move failed", async () => {
    renderDialog([
      { method: "GET", path: /\/projects$/, body: { items: [NORTH], next_cursor: null } },
      { method: "POST", path: /\/move$/, status: 202, body: { job: moveJob(NORTH.id) } },
      {
        method: "GET",
        path: /\/jobs\/[^/]+$/,
        body: { ...moveJob(NORTH.id, "failed"), error: "North site already has this map" },
      },
    ]);
    await screen.findByRole("option", { name: "North site" });
    fireEvent.click(screen.getByRole("button", { name: "Move map" }));
    expect(await screen.findByText("North site already has this map")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
  });
});
