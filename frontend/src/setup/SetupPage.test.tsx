import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import { errorBody, exampleProject, fakeClient, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import {
  THERMAL,
  VERTICAL_HOTKEYS,
  VERTICAL_IDS,
  VISUAL,
  doneInspectJob,
  inspectJob,
  inspectResult,
  setupRoutes,
  typeSpec,
} from "@/test/setupFixtures";
import { useSetupDraft } from "./draftStore";
import { SetupPage } from "./SetupPage";

/** What `GET /library/jobs/{id}` answers next. */
let job: Job;

function renderPage(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient(
    setupRoutes([
      ...extra,
      { method: "POST", path: /\/projects$/, status: 201, body: exampleProject },
      { method: "POST", path: /\/setup\/inspect$/, status: 202, body: () => ({ job: inspectJob() }) },
      { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: () => job },
    ]),
  );
  const view = renderWithProviders(
    <>
      <SetupPage />
      <LocationProbe />
    </>,
    { api, route: "/projects/new", path: "*" },
  );
  return { requests, ...view };
}

const posts = (requests: RecordedRequest[], suffix: string) =>
  requests.filter((r) => r.method === "POST" && r.url.endsWith(suffix));
const realEnsures = (requests: RecordedRequest[]) =>
  posts(requests, "/catalogue/types/ensure").filter((r) => !(r.body as { dry_run?: boolean }).dry_run);

async function sortTyped(path: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Folder or file path" }), { target: { value: path } });
  fireEvent.click(screen.getByRole("button", { name: "Sort files" }));
}

describe("SetupPage", () => {
  beforeEach(() => {
    useSetupDraft.getState().discard();
    useJobsStore.setState({ jobs: {} });
    job = inspectJob();
  });

  it("has the four cards in order and the summary", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "New project" })).toBeInTheDocument();
    const cards = ["What are you inspecting?", "Basics", "Data", "Anomalies to look for"].map((name) =>
      screen.getByRole("region", { name }),
    );
    for (let i = 1; i < cards.length; i += 1)
      expect(cards[i - 1].compareDocumentPosition(cards[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Summary" })).toBeInTheDocument();
    expect(await screen.findByRole("radio", { name: /^Vertical asset inspection/ })).toBeInTheDocument();
  });

  // Moved from ProjectsScreen.test.tsx (the New project dialog's cases).
  it("asks for a folder instead of sending a request the backend will reject", () => {
    const { requests } = renderPage();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    expect(
      within(screen.getByRole("list", { name: "Setup checklist" })).getByText(
        "Choose a folder for the project.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(posts(requests, "/projects")).toHaveLength(0);
  });

  it("creates a project with the template's types and hotkeys, and opens it", async () => {
    const { requests } = renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /^Vertical asset inspection/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tower Q3" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:\\Projects\\Tower-Q3" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${exampleProject.id}/overview`),
    );
    expect(realEnsures(requests)).toHaveLength(1);
    expect(posts(requests, "/projects")[0].body).toEqual({
      name: "Tower Q3",
      folder: "E:\\Projects\\Tower-Q3",
      type_ids: VERTICAL_IDS,
      hotkeys: VERTICAL_HOTKEYS,
    });
    expect(useSetupDraft.getState().name).toBe(""); // Create discards the draft
  });

  it("still creates a project when the catalogue is unavailable", async () => {
    const down = errorBody("catalogue_unavailable", "catalogue.db could not be opened");
    const { requests } = renderPage([
      { method: "GET", path: /\/project-templates$/, status: 503, body: down },
      { method: "GET", path: /\/catalogue\/types$/, status: 503, body: down },
    ]);
    await screen.findByText(/only Blank is offered/);
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Save as my template" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:/Projects/Yard" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() =>
      expect(posts(requests, "/projects")[0]?.body).toEqual({
        name: "Yard",
        folder: "E:/Projects/Yard",
        type_ids: [],
      }),
    );
    expect(posts(requests, "/catalogue/types/ensure")).toHaveLength(0);
  });

  it("shows which field the backend rejected", async () => {
    renderPage([
      {
        method: "POST",
        path: /\/projects$/,
        status: 422,
        body: errorBody("validation_error", "request validation failed", {
          errors: [{ loc: ["body", "folder"], msg: "folder already holds a project", type: "value_error" }],
        }),
      },
    ]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "E:\\Projects\\A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(
      await within(screen.getByRole("complementary", { name: "Summary" })).findByText(
        "folder: folder already holds a project",
      ),
    ).toBeInTheDocument();
    expect(useSetupDraft.getState().name).toBe("Site A");
  });

  it("the draft survives leaving the page, and Discard draft clears it", async () => {
    const first = renderPage();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Site A" } });
    first.unmount();
    renderPage();
    expect(screen.getByLabelText("Name")).toHaveValue("Site A");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/projects"));
    expect(useSetupDraft.getState().name).toBe("");
  });

  it("leaving mid-sort and coming back sorts the files once", async () => {
    const first = renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: /^Vertical asset inspection/ }));
    await sortTyped("E:\\DCIM");
    await screen.findByRole("status", { name: "Sorting files" });
    first.unmount();

    job = doneInspectJob(
      inspectResult([VISUAL, THERMAL], {
        not_recognised: {
          count: 2,
          samples: [
            { name: "Thumbs.db", reason: "unknown type" },
            { name: "notes.txt", reason: "unknown type" },
          ],
        },
      }),
    );
    renderPage();
    await within(screen.getByRole("region", { name: "Visual photos" })).findByRole("listitem", {
      name: "100MEDIA · visual",
    });
    expect(screen.getByRole("button", { name: /^2 files not recognised/ })).toBeInTheDocument();
    expect(useSetupDraft.getState().inspect).toBeNull();
  });

  it("Use it on a suggestion goes through replace-or-keep", async () => {
    job = doneInspectJob(inspectResult([VISUAL, THERMAL], { suggested_template_id: "builtin-vertical" }));
    renderPage();
    await screen.findByRole("radio", { name: /^Vertical asset inspection/ });
    act(() => {
      useSetupDraft.getState().addType(typeSpec("Rust", "defect", 2, "9"));
    });
    await sortTyped("E:\\DCIM");
    fireEvent.click(await screen.findByRole("button", { name: "Use it" }));
    expect(screen.getByText("You changed the anomaly list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine and add the new ones" }));
    expect(useSetupDraft.getState().templateId).toBe("builtin-vertical");
    expect(useSetupDraft.getState().types.map((t) => t.name)).toContain("Rust");
    expect(screen.getByRole("radio", { name: /^Vertical asset inspection/ })).toBeChecked();
  });

  describe("below 1100 px", () => {
    const original = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        media: "(min-width: 1100px)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = original;
    });

    it("the summary is a bottom bar with the checklist in a popover", () => {
      renderPage();
      expect(screen.queryByRole("complementary", { name: "Summary" })).toBeNull();
      const bar = screen.getByRole("region", { name: "Summary" });
      fireEvent.click(within(bar).getByRole("button", { name: "Checklist" }));
      expect(screen.getByRole("dialog", { name: "Setup checklist" })).toHaveTextContent(
        "Give the project a name.",
      );
      expect(screen.getAllByRole("button", { name: "Create project" })).toHaveLength(1);
    });
  });
});
