import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Job } from "@contract/client";
import { fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { useProjectKindStore } from "./useProjectKind";
import { AdoptionBanner } from "./AdoptionBanner";

const adoptJob: Job = { ...runningJob, type: "library_adopt", progress: 0.5, message: "Adopting yard-v2" };

function render(routes: Parameters<typeof fakeClient>[0]) {
  const client = fakeClient(routes);
  renderWithProviders(<AdoptionBanner projectId={PROJECT_ID} />, { api: client.api });
  return client;
}

describe("AdoptionBanner", () => {
  beforeEach(() => {
    useJobsStore.setState({ jobs: {}, panelOpen: false });
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "train" } });
  });

  it("shows progress while the project's models are moving into the library", async () => {
    render([
      {
        method: "GET",
        path: /\/adoption$/,
        body: { pending: 2, adopted: 1, missing: [], job_id: adoptJob.id },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: adoptJob },
    ]);
    expect(await screen.findByText(/Moving this project's models into your library/)).toBeInTheDocument();
    const bar = await screen.findByRole("progressbar");
    await waitFor(() => expect(bar).toHaveAttribute("aria-valuenow", "50"));
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("lists models that could not be moved and retries them", async () => {
    const { requests } = render([
      {
        method: "GET",
        path: /\/adoption$/,
        body: {
          pending: 1,
          adopted: 2,
          missing: [
            { old_model_id: "old-1", name: "yard-v1", error: "weights file not found: models/yard-v1.pt" },
          ],
          job_id: null,
        },
      },
      { method: "POST", path: /\/adoption\/retry$/, status: 202, body: { job: adoptJob } },
    ]);
    expect(await screen.findByText("yard-v1")).toBeInTheDocument();
    expect(screen.getByText(/weights file not found: models\/yard-v1\.pt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.url).toBe(
      `/api/v1/projects/${PROJECT_ID}/adoption/retry`,
    );
    await waitFor(() => expect(useJobsStore.getState().jobs[adoptJob.id]?.type).toBe("library_adopt"));
    expect(await screen.findByText(/Moving this project's models into your library/)).toBeInTheDocument();
  });

  it("reloads the status when the job had already finished by the time it was read", async () => {
    let calls = 0;
    render([
      {
        method: "GET",
        path: /\/adoption$/,
        body: () =>
          calls++ === 0
            ? { pending: 1, adopted: 0, missing: [], job_id: adoptJob.id }
            : {
                pending: 0,
                adopted: 0,
                missing: [{ old_model_id: "old-1", name: "yard-v1", error: "weights file not found" }],
                job_id: null,
              },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: { ...adoptJob, state: "succeeded", progress: 1 } },
    ]);
    expect(await screen.findByText("yard-v1")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("shows progress right after a retry even when nothing is counted as pending", async () => {
    render([
      {
        method: "GET",
        path: /\/adoption$/,
        body: {
          pending: 0,
          adopted: 2,
          missing: [{ old_model_id: "old-1", name: "yard-v1", error: "weights file not found" }],
          job_id: null,
        },
      },
      { method: "POST", path: /\/adoption\/retry$/, status: 202, body: { job: adoptJob } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Moving this project's models into your library/)).toBeInTheDocument();
  });

  it("shows nothing once every model is in the library", async () => {
    const { requests } = render([
      { method: "GET", path: /\/adoption$/, body: { pending: 0, adopted: 3, missing: [], job_id: null } },
    ]);
    await waitFor(() => expect(requests).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not ask about adoption in a detection project", async () => {
    useProjectKindStore.setState({ byProject: { [PROJECT_ID]: "detect" } });
    const { requests } = render([
      { method: "GET", path: /\/adoption$/, body: { pending: 0, adopted: 0, missing: [], job_id: null } },
    ]);
    await act(async () => {});
    expect(requests).toHaveLength(0);
  });

  it("reloads the status when the adoption job finishes", async () => {
    let calls = 0;
    render([
      {
        method: "GET",
        path: /\/adoption$/,
        body: () =>
          calls++ === 0
            ? { pending: 1, adopted: 0, missing: [], job_id: adoptJob.id }
            : { pending: 0, adopted: 1, missing: [], job_id: null },
      },
      { method: "GET", path: /\/jobs\/[^/]+$/, body: adoptJob },
    ]);
    expect(await screen.findByText(/Moving this project's models/)).toBeInTheDocument();
    await waitFor(() => expect(useJobsStore.getState().jobs[adoptJob.id]).toBeDefined());
    act(() => useJobsStore.getState().upsert({ ...adoptJob, state: "succeeded", progress: 1 }));
    await waitFor(() => expect(screen.queryByText(/Moving this project's models/)).toBeNull());
  });
});
