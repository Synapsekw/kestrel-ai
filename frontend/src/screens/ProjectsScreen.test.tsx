import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, exampleProject, fakeClient, runningJob, type FakeRoute } from "@/test/fixtures";
import { severityRoute, TYPE_CRACK, TYPE_SPALLING } from "@/test/findingFixtures";
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
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    try {
      renderList();
      fireEvent.click(
        within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", {
          name: "Details",
        }),
      );
      fireEvent.click(await screen.findByRole("button", { name: "Copy backup path" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(failedProject.migration.backup_path));
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("sends one retry when Retry is clicked twice", async () => {
    const requests = renderList([failedProject]);
    const retry = within(await screen.findByRole("article", { name: "Yard 7" })).getByRole("button", {
      name: "Retry",
    });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/projects"))).toHaveLength(2));
    expect(requests.filter((r) => r.url.endsWith("/migrations/retry"))).toHaveLength(1);
  });

  it("says why a project cannot be opened, for each state", async () => {
    renderList([failedProject, pendingProject]);
    const openOf = async (name: string) =>
      within(await screen.findByRole("article", { name })).getByRole("button", { name: "Open" });
    const failedOpen = await openOf("Yard 7");
    fireEvent.mouseEnter(failedOpen.parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Retry the upgrade first.");
    fireEvent.mouseLeave(failedOpen.parentElement!);
    fireEvent.mouseEnter((await openOf("Quarry")).parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("It opens once the upgrade has finished.");
  });

  it("shows no project kind: no kind label and no kind filter", async () => {
    renderList();
    await screen.findByRole("article", { name: "Ahmadia Tower" });
    expect(screen.queryByText(/training project|detection project/i)).toBeNull();
    expect(screen.queryByText(/^(training|detection)$/i)).toBeNull();
    expect(screen.getAllByRole("combobox").map((c) => c.getAttribute("aria-label"))).toEqual([
      "Sort projects",
    ]);
    const sortOptions = screen.getByRole("combobox", { name: "Sort projects" }).querySelectorAll("option");
    expect(Array.from(sortOptions).map((o) => o.value)).toEqual(["recent", "name", "findings"]);
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

const catalogue: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/types$/,
  body: {
    items: [
      {
        id: TYPE_SPALLING,
        name: "Spalling",
        colour: "#ff5a4f",
        kind: "defect",
        archived: false,
        group: "Concrete defects",
      },
      { id: TYPE_CRACK, name: "Crack", colour: "#ff9c3a", kind: "defect", archived: false, group: null },
      { id: "t-old", name: "Old type", colour: "#888888", kind: "object", archived: true, group: null },
    ],
  },
};

describe("ProjectsScreen: new project and open folder", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {} }));

  it("locates a missing project's folder through the open-folder flow", async () => {
    const requests = renderList(
      [missingProject],
      [
        {
          method: "POST",
          path: /\/projects\/open$/,
          body: { ...missingProject, folder: "E:\\Moved\\Yard-9", availability: "ok" },
        },
      ],
    );
    const gone = await screen.findByRole("article", { name: "Yard 9" });
    fireEvent.click(within(gone).getByRole("button", { name: "Locate folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "Locate Yard 9" });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Moved\\Yard-9" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this folder" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/projects/open"))?.body).toEqual({
        folder: "E:\\Moved\\Yard-9",
      }),
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/p/p-gone/overview"));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("asks for a folder instead of sending a request the backend will reject", async () => {
    const requests = renderList([], [catalogue]);
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await within(dialog).findByText("Choose a folder for the project.")).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("creates a project with the chosen types and no kind, then opens it", async () => {
    const requests = renderList(
      [],
      [catalogue, { method: "POST", path: /\/projects$/, status: 201, body: exampleProject }],
    );
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Tower Q3" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), {
      target: { value: "E:\\Projects\\Tower-Q3" },
    });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Spalling/ }));
    expect(within(dialog).queryByText("Old type")).toBeNull();
    // Bounded: one page at the API's maximum, never an unbounded walk of the catalogue.
    expect(requests.find((r) => r.url.includes("/catalogue/types"))?.url).toContain("limit=1000");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        name: "Tower Q3",
        folder: "E:\\Projects\\Tower-Q3",
        type_ids: [TYPE_SPALLING],
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${exampleProject.id}/overview`),
    );
  });

  it("still creates a project when the catalogue is unavailable", async () => {
    const requests = renderList(
      [],
      [
        {
          method: "GET",
          path: /\/catalogue\/types$/,
          status: 503,
          body: errorBody("catalogue_unavailable", "catalogue.db could not be opened"),
        },
        { method: "POST", path: /\/projects$/, status: 201, body: exampleProject },
      ],
    );
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    expect(await within(dialog).findByText(/The catalogue is unavailable/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:/Projects/Yard" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ type_ids: [] }),
    );
  });

  it("shows which field the backend rejected", async () => {
    renderList(
      [],
      [
        catalogue,
        {
          method: "POST",
          path: /\/projects$/,
          status: 422,
          body: errorBody("validation_error", "request validation failed", {
            errors: [{ loc: ["body", "folder"], msg: "folder already holds a project", type: "value_error" }],
          }),
        },
      ],
    );
    fireEvent.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = await screen.findByRole("dialog", { name: "New project" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Projects\\A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create project" }));
    expect(await within(dialog).findByText("folder: folder already holds a project")).toBeInTheDocument();
  });

  it("opens an existing folder", async () => {
    const requests = renderList([], [{ method: "POST", path: /\/projects\/open$/, body: exampleProject }]);
    fireEvent.click(await screen.findByRole("button", { name: "Open folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Open a project folder" });
    fireEvent.change(within(dialog).getByLabelText("Folder"), { target: { value: "E:\\Projects\\Old" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Open project" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/projects/open"))?.body).toEqual({
        folder: "E:\\Projects\\Old",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${exampleProject.id}/overview`),
    );
  });
});
