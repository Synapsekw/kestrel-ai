import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, runningJob, type FakeRoute } from "@/test/fixtures";
import { severityRoute } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import {
  failedProject,
  missingProject,
  okProject,
  pendingProject,
  upgradingProject,
} from "./projects/projectFixtures";
import { ProjectsScreen } from "./ProjectsScreen";

function renderList(
  items = [okProject, upgradingProject, failedProject, pendingProject],
  extra: FakeRoute[] = [],
) {
  const { api, requests } = fakeClient([
    ...extra,
    { method: "GET", path: /\/projects$/, body: { items, next_cursor: null } },
    {
      method: "GET",
      path: /\/library\/jobs\/[^/]+$/,
      body: { ...runningJob, id: "j-migrate", project_id: "library", type: "project_migrate", progress: 0.4 },
    },
    {
      method: "POST",
      path: /\/projects\/migrations\/retry$/,
      status: 202,
      body: { state: "running", job_id: "j2" },
    },
    severityRoute,
  ]);
  renderWithProviders(
    <>
      <ProjectsScreen />
      <LocationProbe />
    </>,
    // "*" keeps the probe mounted after Open navigates away from /projects.
    { api, route: "/projects", path: "*" },
  );
  return requests;
}

const card = (name: string) => screen.getByRole("article", { name });

describe("ProjectsScreen: the list", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {} });
    useChangesStore.setState({ projectsRevision: 0 });
  });

  it("shows a card per project with folder, open findings and data chips", async () => {
    renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    const ok = card("Ahmadia Tower");
    expect(within(ok).getByText("E:\\Projects\\Ahmadia-Tower")).toBeInTheDocument();
    expect(within(ok).getByText("47 open")).toBeInTheDocument();
    expect(within(ok).getByText("5 Critical")).toBeInTheDocument();
    expect(within(ok).getByText("1,284 images")).toBeInTheDocument();
    expect(ok.querySelector("img")?.getAttribute("src")).toContain("/preview?token=");
  });

  it("removes a project from the list after asking, and says the folder stays", async () => {
    const requests = renderList([okProject], [{ method: "DELETE", path: /\/projects\/[^/]+$/, status: 204 }]);
    const ok = await screen.findByRole("article", { name: "Ahmadia Tower" });
    fireEvent.click(within(ok).getByRole("button", { name: "More for Ahmadia Tower" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from the list" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Ahmadia Tower from the list?" });
    expect(dialog).toHaveTextContent("The folder and everything in it stay on disk");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Ahmadia Tower" })).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe("/api/v1/projects/p-ok");
  });

  it("opens a healthy project on its Overview", async () => {
    renderList();
    fireEvent.click(
      within(await screen.findByRole("article", { name: "Ahmadia Tower" })).getByRole("button", {
        name: "Open",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/p/p-ok/overview"));
  });

  it("shows an upgrade in progress, and the project cannot be opened", async () => {
    renderList();
    const up = await screen.findByRole("article", { name: "Bridge B2" });
    expect(within(up).getByText("Upgrading…")).toBeInTheDocument();
    expect(within(up).getByRole("button", { name: "Open" })).toBeDisabled();
    await waitFor(() => expect(within(up).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40"));
  });

  it("lists a failed project next to a healthy one, with Retry and Details", async () => {
    const requests = renderList();
    const bad = await screen.findByRole("article", { name: "Yard 7" });
    expect(within(bad).getByText("Couldn't upgrade")).toBeInTheDocument();
    expect(within(bad).getByRole("button", { name: "Open" })).toBeDisabled();
    fireEvent.click(within(bad).getByRole("button", { name: "Details" }));
    const dialog = await screen.findByRole("dialog", { name: "Yard 7 could not be upgraded" });
    expect(dialog).toHaveTextContent("database disk image is malformed");
    expect(dialog).toHaveTextContent(failedProject.migration.backup_path!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.click(within(bad).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/migrations/retry"))?.body).toEqual({
        folder: failedProject.folder,
      }),
    );
    // Retry re-reads the list so the card picks up the running upgrade.
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/projects"))).toHaveLength(2));
    expect(screen.getByRole("article", { name: "Ahmadia Tower" })).toBeInTheDocument();
  });

  it("lists a project whose folder is gone as Folder not found, and removes it from the list", async () => {
    const requests = renderList(
      [okProject, missingProject],
      [{ method: "DELETE", path: /\/projects\/[^/]+$/, status: 204 }],
    );
    const gone = await screen.findByRole("article", { name: "Yard 9" });
    expect(within(gone).getByText("Folder not found")).toBeInTheDocument();
    expect(within(gone).queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(within(gone).getByRole("button", { name: "Remove from list" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Yard 9 from the list?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove from the list" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "Yard 9" })).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe("/api/v1/projects/p-gone");
    expect(screen.getByRole("article", { name: "Ahmadia Tower" })).toBeInTheDocument();
  });

  it("reveals the backup in Explorer through the backend", async () => {
    const requests = renderList(
      [failedProject],
      [{ method: "POST", path: /\/migrations\/reveal-backup$/, status: 204 }],
    );
    fireEvent.click(
      within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", { name: "Details" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reveal backup" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/migrations/reveal-backup"))?.body).toEqual({
        folder: failedProject.folder,
      }),
    );
  });

  it("copies the backup path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderList();
    fireEvent.click(
      within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", { name: "Details" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Copy backup path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(failedProject.migration.backup_path));
  });

  it("searches by name and sorts", async () => {
    renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "yard" },
    });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["Yard 7"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort projects" }), { target: { value: "name" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual([
      "Ahmadia Tower",
      "Bridge B2",
      "Quarry",
      "Yard 7",
    ]);
  });

  it("re-reads the list on migration.changed", async () => {
    const requests = renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    useChangesStore.setState({ projectsRevision: 1 });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/projects"))).toHaveLength(2));
  });

  it("marks a project with a running job as live", async () => {
    useJobsStore.getState().upsert({ ...runningJob, project_id: "p-ok" });
    renderList();
    const ok = await screen.findByRole("article", { name: "Ahmadia Tower" });
    expect(within(ok).getByText("Job running")).toBeInTheDocument();
  });

  it("says when the list cannot be read, and reads it again on Retry", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/projects$/, status: 500, body: errorBody("internal", "disk unavailable") },
    ]);
    renderWithProviders(<ProjectsScreen />, { api });
    expect(await screen.findByText("disk unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/projects"))).toHaveLength(2));
  });

  it("says how to start when the list is empty", async () => {
    renderList([]);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });
});
