import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { useToastStore } from "@/ui";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { renderWithProviders } from "@/test/render";
import { CloudsScreen } from "./CloudsScreen";

// The viewer needs WebGL; the screen's own behaviour is tested around a stand-in.
// A forwardRef stand-in, because the screen hands the viewer a ref.
vi.mock("@/clouds/CloudViewer", async () => {
  const { forwardRef } = await import("react");
  return {
    CloudViewer: forwardRef(function CloudViewer() {
      return <div data-testid="cloud-viewer" />;
    }),
  };
});

const routes = (items: object[]) => [
  { method: "GET", path: /\/pointclouds$/, body: { items } },
  { method: "GET", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), body: items[0] ?? null },
  { method: "GET", path: /\/maps$/, body: { items: [] } },
];

describe("Clouds screen", () => {
  it("invites an import when there are no clouds", async () => {
    const { api } = fakeClient(routes([]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    expect(await screen.findByText("Import a LAS or LAZ point cloud")).toBeInTheDocument();
  });

  it("lists clouds with their facts and a failed one with its reason", async () => {
    const failed = {
      ...exampleCloud,
      id: "c2",
      name: "Broken",
      status: "failed",
      error: "the file has no points",
      point_count: null,
    };
    const { api } = fakeClient(routes([exampleCloud, failed]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds",
    });
    const list = await screen.findByRole("list", { name: "Point clouds" });
    expect(list).toHaveTextContent("21.7 M points");
    expect(list).toHaveTextContent("EPSG:32639");
    expect(list).toHaveTextContent("738 MB");
    expect(screen.getByText("the file has no points")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import again" })).toBeInTheDocument();
  });

  it("shows Details, and View with RGB disabled for a cloud without colour", async () => {
    const grey = { ...exampleCloud, has_rgb: false };
    const { api } = fakeClient(routes([grey]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const panel = await screen.findByTestId("cloud-panel");
    expect(panel).toHaveTextContent(/Header bounds repaired/);
    expect(panel).toHaveTextContent("as stored, no vertical datum");
    await userEvent.click(screen.getByRole("radio", { name: "View" }));
    expect(screen.getByRole("radio", { name: "RGB" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Elevation" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
    expect(screen.getByLabelText("Highest")).toHaveValue(170);
  });

  it("offers Assign CRS only when the cloud has no coordinates", async () => {
    const bare = { ...exampleCloud, crs_wkt: null, epsg: null, proj4: null, bounds_wgs84: null };
    const { api } = fakeClient(routes([bare]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    expect(await screen.findByLabelText("EPSG code")).toBeInTheDocument();
  });

  it("re-seeds the view settings when an importing cloud becomes ready", async () => {
    const importJob: Job = { ...runningJob, id: "j-import-1", type: "pointcloud_import", state: "running" };
    // The screen saw the import running; the poll then answers it finished.
    useJobsStore.getState().upsert(importJob);
    const importing = {
      ...exampleCloud,
      status: "importing",
      has_rgb: null,
      z_stats: null,
      bounds_native: null,
      point_count: null,
      job_id: importJob.id,
    };
    let lists = 0;
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/pointclouds$/,
        body: () => ({ items: [lists++ === 0 ? importing : exampleCloud] }),
      },
      { method: "GET", path: /\/jobs\/j-import-1$/, body: { ...importJob, state: "succeeded", progress: 1 } },
      { method: "GET", path: /\/maps$/, body: { items: [] } },
    ]);
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    await screen.findByTestId("cloud-viewer");
    await userEvent.click(screen.getByRole("radio", { name: "View" }));
    expect(screen.getByRole("radio", { name: "RGB" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Elevation" }));
    expect(screen.getByLabelText("Lowest")).toHaveValue(-44);
  });

  it("toasts a finished LAZ export even after the Details tab was left", async () => {
    const exportJob: Job = { ...runningJob, id: "j-export-1", type: "pointcloud_export", state: "queued" };
    let done = false;
    const { api, requests } = fakeClient([
      ...routes([exampleCloud]),
      { method: "POST", path: /\/exports$/, status: 202, body: { job: exportJob } },
      {
        method: "GET",
        path: /\/jobs\/j-export-1$/,
        body: () =>
          done
            ? { ...exportJob, state: "succeeded", progress: 1, result: { folder: "exports/x" } }
            : { ...exportJob, state: "running" },
      },
    ]);
    useToastStore.getState().clear();
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Export LAZ" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/jobs/j-export-1"))).toBe(true));
    await userEvent.click(screen.getByRole("radio", { name: "View" }));
    done = true;
    await waitFor(
      () => {
        const t = useToastStore.getState().toasts.find((x) => x.text === "LAZ export finished");
        expect(t?.action?.label).toBe("Show folder");
      },
      { timeout: 5000 },
    );
  }, 10_000);

  it("keeps following a LAZ export after the screen was left and opened again", async () => {
    // Final review F1: Export, go to Maps (the screen unmounts), come back, the job then ends.
    const exportJob: Job = {
      ...runningJob,
      id: "j-export-2",
      type: "pointcloud_export",
      state: "queued",
      params: { cloud_id: CLOUD_ID },
    };
    let done = false;
    const { api, requests } = fakeClient([
      ...routes([exampleCloud]),
      { method: "POST", path: /\/exports$/, status: 202, body: { job: exportJob } },
      {
        method: "GET",
        path: /\/jobs\/j-export-2$/,
        body: () =>
          done
            ? { ...exportJob, state: "succeeded", progress: 1, result: { folder: "exports/y" } }
            : { ...exportJob, state: "running" },
      },
    ]);
    useToastStore.getState().clear();
    const opts = { api, route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`, path: "/p/:projectId/clouds/:cloudId" };
    const first = renderWithProviders(<CloudsScreen />, opts);
    await userEvent.click(await screen.findByRole("button", { name: "Export LAZ" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/jobs/j-export-2"))).toBe(true));
    first.unmount();
    renderWithProviders(<CloudsScreen />, opts);
    // Details knows the export is still running: no second export can start.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Export LAZ" })).toHaveAttribute("aria-busy", "true"),
    );
    done = true;
    await waitFor(
      () => {
        const t = useToastStore.getState().toasts.find((x) => x.text === "LAZ export finished");
        expect(t?.action?.label).toBe("Show folder");
      },
      { timeout: 5000 },
    );
  }, 10_000);

  it("keeps View and Measure for a ready cloud, and says what an importing or failed one is doing", async () => {
    // Final review F3.
    const importing = { ...exampleCloud, status: "importing", z_stats: null, has_rgb: null };
    const { api } = fakeClient(routes([importing]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const centre = await screen.findByTestId("cloud-centre");
    expect(centre).toHaveTextContent("Building the 3D view copy…");
    expect(centre).not.toHaveTextContent("Pick a cloud on the left");
    expect(screen.getByRole("radio", { name: "View" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Measure" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Details" })).toBeEnabled();
  });

  it("shows a failed cloud's reason in the centre, with View and Measure off", async () => {
    const failed = { ...exampleCloud, status: "failed", error: "the file has no points" };
    const { api } = fakeClient(routes([failed]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const centre = await screen.findByTestId("cloud-centre");
    expect(centre).toHaveTextContent(`${exampleCloud.name} could not be imported`);
    expect(centre).toHaveTextContent("the file has no points");
    expect(screen.getByRole("radio", { name: "View" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Measure" })).toBeDisabled();
  });

  it("Import again keeps the failed cloud's map link and capture date", async () => {
    // Final review F5.
    const failed = {
      ...exampleCloud,
      status: "failed",
      error: "import interrupted by application restart; import the file again",
      map_id: "m-1",
      captured_on: "2026-05-04",
    };
    const fresh = { ...exampleCloud, id: "c-new", status: "importing", map_id: "m-1", captured_on: null };
    const importJob: Job = { ...runningJob, id: "j-import-9", type: "pointcloud_import", state: "queued" };
    const { api, requests } = fakeClient([
      ...routes([failed]),
      { method: "POST", path: /\/pointclouds$/, status: 202, body: { cloud: fresh, job: importJob } },
      { method: "PATCH", path: /\/pointclouds\/c-new$/, body: { ...fresh, captured_on: "2026-05-04" } },
      { method: "DELETE", path: new RegExp(`/pointclouds/${CLOUD_ID}$`), status: 204, body: null },
      { method: "GET", path: /\/pointclouds\/c-new$/, body: fresh },
      { method: "GET", path: /\/jobs\/j-import-9$/, body: importJob },
    ]);
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds`,
      path: "/p/:projectId/clouds/:cloudId?",
    });
    await userEvent.click(await screen.findByRole("button", { name: "Import again" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    const post = requests.find((r) => r.method === "POST");
    expect(post?.body).toEqual({ path: failed.source_path, name: failed.name, map_id: "m-1" });
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toMatch(/\/pointclouds\/c-new$/);
    expect(patch?.body).toEqual({ captured_on: "2026-05-04" });
  });

  it("saves the capture date when the field is left, not on every keystroke", async () => {
    // Final review F6.
    const { api, requests } = fakeClient([
      ...routes([exampleCloud]),
      {
        method: "PATCH",
        path: new RegExp(`/pointclouds/${CLOUD_ID}$`),
        body: { ...exampleCloud, captured_on: "2026-05-12" },
      },
    ]);
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    const input = await screen.findByLabelText("Captured on");
    // A date typed year by year passes through intermediate years.
    for (const v of ["0002-05-12", "0020-05-12", "0202-05-12", "2026-05-12"])
      fireEvent.change(input, { target: { value: v } });
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    fireEvent.blur(input);
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ captured_on: "2026-05-12" });
    fireEvent.blur(await screen.findByLabelText("Captured on")); // nothing changed since: no second save
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  });

  it("offers Export LAZ only for a ready cloud and keeps a link that no longer qualifies", async () => {
    const linked = { ...exampleCloud, status: "failed", error: "boom", map_id: "m-gone" };
    const { api } = fakeClient(routes([linked]));
    renderWithProviders(<CloudsScreen />, {
      api,
      route: `/p/${PROJECT_ID}/clouds/${CLOUD_ID}`,
      path: "/p/:projectId/clouds/:cloudId",
    });
    expect(await screen.findByRole("button", { name: "Export LAZ" })).toBeDisabled();
    expect(screen.getByLabelText("Linked map")).toHaveValue("m-gone");
  });
});
