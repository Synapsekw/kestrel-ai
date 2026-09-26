import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders, TestApiProvider } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import type { FakeRoute } from "@/test/fixtures";
import { ImportDesignDialog } from "./ImportDesignDialog";
import {
  BUILD_JOB,
  blockedPreview,
  designSurface,
  exampleTarget,
  INSPECT_JOB,
  INSPECTION_ID,
  landxmlInspection,
  PREVIEW_JOB,
  readyPreview,
  warnPreview,
} from "./testFixtures";

const job = (id: string, state: string) => ({
  id,
  project_id: PROJECT_ID,
  type: "design_import",
  state,
  progress: state === "succeeded" ? 1 : 0.3,
  message: "Reading design file",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});

function routes(preview = readyPreview, extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/surfaces$/, body: { items: [exampleTarget] } },
    {
      method: "POST",
      path: /\/design-inspections$/,
      status: 202,
      body: {
        inspection: { ...landxmlInspection, state: "inspecting", candidates: [], detected: null },
        job: job(INSPECT_JOB, "queued"),
      },
    },
    { method: "GET", path: new RegExp(`/jobs/${INSPECT_JOB}$`), body: job(INSPECT_JOB, "succeeded") },
    { method: "GET", path: new RegExp(`/design-inspections/${INSPECTION_ID}$`), body: landxmlInspection },
    {
      method: "POST",
      path: /\/previews$/,
      status: 202,
      body: { preview: { ...preview, state: "running" }, job: job(PREVIEW_JOB, "queued") },
    },
    { method: "GET", path: new RegExp(`/jobs/${PREVIEW_JOB}$`), body: job(PREVIEW_JOB, "succeeded") },
    { method: "GET", path: /\/previews\/[^/]+$/, body: preview },
    {
      method: "POST",
      path: /\/design-surfaces$/,
      status: 202,
      body: { surface: designSurface, job: job(BUILD_JOB, "queued") },
    },
    { method: "DELETE", path: /\/design-inspections\/[^/]+$/, status: 204 },
  ];
}

async function readFile() {
  fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\designs\\site-tin.xml" } });
  fireEvent.click(screen.getByRole("button", { name: "Read file" }));
  await screen.findByRole("combobox", { name: "Surface" });
}

async function preview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("img", { name: "The design over the cloud surface" });
}

describe("ImportDesignDialog", () => {
  it("reads a LandXML file and prefills the placement", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({ path: "D:\\designs\\site-tin.xml" });
    expect(screen.getByRole("combobox", { name: "Surface" })).toHaveValue("c0");
    expect(screen.getByRole("option", { name: /Grid 1m/ })).toBeDisabled();
    expect(screen.getByLabelText("Source CRS")).toHaveValue("EPSG:32639");
    expect(screen.getByText("From the file: LandXML <CoordinateSystem epsgCode>")).toBeInTheDocument();
    expect(screen.getByText("LandXML stores northing first — already handled")).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "US survey foot (1200/3937 m)" })).toHaveLength(2);
    expect(screen.queryByLabelText("Cell size (m)")).not.toBeInTheDocument(); // a target is chosen
  });

  it("shows the DWG answer inline under the file", async () => {
    const dwg = {
      method: "POST",
      path: /\/design-inspections$/,
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message:
            "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF.",
          details: { reason: "dwg" },
        },
      },
    };
    const { api } = fakeClient([dwg]);
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Design file"), { target: { value: "D:\\site.dwg" } });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByText(/save it as DXF/)).toBeInTheDocument();
  });

  it("previews, marks the preview stale on change, and imports", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByText("97.3 %")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    expect(screen.getByText("Preview out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Swap easting and northing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(designSurface));
    const post = requests.find((r) => r.url.endsWith("/design-surfaces"));
    expect(post?.body).toEqual({
      inspection_id: INSPECTION_ID,
      preview_id: readyPreview.id,
      accept_warnings: false,
      name: "site-tin — Existing ground",
    });
    expect(useJobsStore.getState().jobs[BUILD_JOB]?.type).toBe("design_import");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("needs the checkbox on warnings and applies a suggestion with a new preview", async () => {
    const { api, requests } = fakeClient(routes(warnPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Import despite these warnings" }));
    expect(screen.getByRole("button", { name: "Import surface" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/previews"))).toHaveLength(2));
    const second = requests.filter((r) => r.url.endsWith("/previews"))[1];
    expect((second.body as { swap_xy: boolean }).swap_xy).toBe(true);
  });

  it("refuses to import a blocked preview and says why", async () => {
    const { api } = fakeClient(routes(blockedPreview));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
    expect(
      screen.getByText("This design can't be imported: the selection mixes 3D faces and lines"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Import despite these warnings" })).not.toBeInTheDocument();
  });

  it("deletes the inspection when closed before importing", async () => {
    const onClose = vi.fn();
    const { api, requests } = fakeClient(routes());
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={onClose} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });

  // Task 6 review (a): unmounting (the button closes the dialog) while the create request is
  // still in flight must not leak the inspection it eventually creates.
  it("deletes the inspection if the create request resolves after the dialog was closed", async () => {
    const { api, requests } = fakeClient(routes());
    const { unmount } = renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Design file"), {
      target: { value: "D:\\designs\\site-tin.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    // Unmount synchronously, before the fake POST's promise has a chance to resolve.
    unmount();
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
  });

  // Task 6 review (b): once an import has started, the inspection belongs to the surface build;
  // Cancel (or an unmount that races it) must not delete it.
  it("does not delete the inspection once an import has started", async () => {
    const onStarted = vi.fn();
    const { api, requests } = fakeClient(routes());
    const { unmount } = renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={onStarted} />,
      { api },
    );
    await readFile();
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(designSurface));
    unmount();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  // Controller follow-up review: unmounting while the createDesignSurface POST is still in flight
  // (not yet resolved, so `onStarted` hasn't fired and `startedRef` isn't "started" yet) must not
  // let the unmount cleanup delete the inspection out from under a request that may still succeed.
  it("does not delete the inspection if unmounted while the import POST is in flight", async () => {
    const { api, requests } = fakeClient(routes());
    const { unmount } = renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
    // Unmount synchronously, before the fake POST's promise has a chance to resolve.
    unmount();
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/design-surfaces"))).toBe(true));
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  // Regression test for the StrictMode bug fixed alongside this task: the dev-only
  // mount→cleanup→mount rehearsal must not leave the dialog unusable, nor delete an inspection
  // that was never actually created.
  it("still reads a file under StrictMode's mount-cleanup-remount rehearsal", async () => {
    const { api, requests } = fakeClient(routes());
    render(
      <StrictMode>
        <TestApiProvider api={api}>
          <MemoryRouter>
            <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />
          </MemoryRouter>
        </TestApiProvider>
      </StrictMode>,
    );
    await readFile();
    expect(screen.getByRole("combobox", { name: "Surface" })).toHaveValue("c0");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  // Task 6 review (c): a tracked job's poller giving up must not leave the progress bar spinning
  // forever; it must offer a way to retry.
  it("shows a retry alert when the inspect job's poller gives up", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/surfaces$/, body: { items: [exampleTarget] } },
      {
        method: "POST",
        path: /\/design-inspections$/,
        status: 202,
        body: {
          inspection: { ...landxmlInspection, state: "inspecting", candidates: [], detected: null },
          job: job(INSPECT_JOB, "queued"),
        },
      },
      {
        method: "GET",
        path: new RegExp(`/jobs/${INSPECT_JOB}$`),
        status: 404,
        body: { error: { code: "not_found", message: "inspect job not found" } },
      },
    ]);
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    fireEvent.change(screen.getByLabelText("Design file"), {
      target: { value: "D:\\designs\\site-tin.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Read file" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("inspect job not found")).toBeInTheDocument();
  });

  it("shows a retry alert when the preview job's poller gives up", async () => {
    const { api } = fakeClient(
      routes(readyPreview, [
        {
          method: "GET",
          path: new RegExp(`/jobs/${PREVIEW_JOB}$`),
          status: 404,
          body: { error: { code: "not_found", message: "preview job not found" } },
        },
      ]),
    );
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("preview job not found")).toBeInTheDocument();
  });

  // Final review 1: a 409 not_ready from createDesignSurface must not leave the dialog at a dead end
  // (Preview disabled, Import repeating the 409, the vanished target still listed).
  // `job_running` (the design is already being imported, e.g. from another window) gets the same
  // recovery: the preview is dropped rather than left pointing at a build that is under way.
  it.each(["not_ready", "job_running"])(
    "offers Preview again and reloads the targets after a 409 %s on import",
    async (code) => {
      let surfaceLists = 0;
      const { api, requests } = fakeClient(
        routes(readyPreview, [
          {
            method: "GET",
            path: /\/surfaces$/,
            body: () => {
              surfaceLists += 1;
              return { items: [exampleTarget] };
            },
          },
          {
            method: "POST",
            path: /\/design-surfaces$/,
            status: 409,
            body: {
              error: {
                code,
                message: "the target surface Chimney DSM is no longer ready; preview again",
                details: {},
              },
            },
          },
        ]),
      );
      renderWithProviders(
        <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
        { api },
      );
      await readFile();
      await preview();
      expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
      expect(surfaceLists).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "Import surface" }));
      expect(await screen.findByText(/no longer ready; preview again/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled());
      expect(screen.getByRole("button", { name: "Import surface" })).toBeDisabled();
      await waitFor(() => expect(surfaceLists).toBe(2));
      expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    },
  );

  // Final review 2: the default name follows the selection until the user types their own.
  it("recomputes the default name when the selection changes, unless the user edited it", async () => {
    const twoSurfaces = {
      ...landxmlInspection,
      candidates: [
        landxmlInspection.candidates[0],
        { ...landxmlInspection.candidates[1], name: "Finished grade", notes: [], face_count: 200 },
      ],
    };
    const { api } = fakeClient(
      routes(readyPreview, [
        { method: "GET", path: new RegExp(`/design-inspections/${INSPECTION_ID}$`), body: twoSurfaces },
      ]),
    );
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByLabelText("Name")).toHaveValue("site-tin — Existing ground");
    fireEvent.change(screen.getByRole("combobox", { name: "Surface" }), { target: { value: "c1" } });
    expect(screen.getByLabelText("Name")).toHaveValue("site-tin — Finished grade");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Final grade v2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Surface" }), { target: { value: "c0" } });
    expect(screen.getByLabelText("Name")).toHaveValue("Final grade v2");
  });

  // Final review 5: warnings dedupe by code AND message, so two may share a code.
  it("renders two warnings that share a code without a duplicate-key warning", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const twoWarnings = {
      ...warnPreview,
      warnings: [
        { code: "outside_target", level: "warn" as const, message: "first message" },
        { code: "outside_target", level: "warn" as const, message: "second message" },
      ],
    };
    const { api } = fakeClient(routes(twoWarnings));
    renderWithProviders(
      <ImportDesignDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />,
      { api },
    );
    await readFile();
    await preview();
    expect(screen.getByText("first message")).toBeInTheDocument();
    expect(screen.getByText("second message")).toBeInTheDocument();
    const dupes = errorSpy.mock.calls.filter((c) => String(c[0]).includes("same key"));
    errorSpy.mockRestore();
    expect(dupes).toHaveLength(0);
  });
});
