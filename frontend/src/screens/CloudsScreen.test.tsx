import { screen, waitFor } from "@testing-library/react";
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
