import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { exampleTypes } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { BackfillOffer } from "./BackfillOffer";

const JOB = { ...runningJob, id: "j-backfill", project_id: "library", type: "findings_backfill" as const };

describe("BackfillOffer", () => {
  it("starts the findings backfill as a library job and links to it in Jobs", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/types\/[^/]+\/backfill$/, status: 202, body: { job: JOB } },
    ]);
    renderWithProviders(<BackfillOffer type={{ ...exampleTypes[0], kind: "defect" }} onDismiss={vi.fn()} />, {
      api,
    });
    expect(screen.getByText("Excavator is now a defect")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Create findings from accepted annotations of this type" }),
    );
    expect(await screen.findByRole("link", { name: "Follow in Jobs" })).toHaveAttribute(
      "href",
      "/jobs?project=library&job=j-backfill",
    );
    expect(requests[0].url).toBe(`/api/v1/catalogue/types/${exampleTypes[0].id}/backfill`);
    expect(useJobsStore.getState().jobs["j-backfill"]?.type).toBe("findings_backfill");
  });

  // Controller ruling P13: 409 `job_running`, details carry `job_id` -> link to that job in Jobs.
  it("says a backfill of this type is already running and links to it when the details carry a job id", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types\/[^/]+\/backfill$/,
        status: 409,
        body: errorBody("job_running", "a backfill is already running", { job_id: "j-existing" }),
      },
    ]);
    renderWithProviders(<BackfillOffer type={{ ...exampleTypes[0], kind: "defect" }} onDismiss={vi.fn()} />, {
      api,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create findings from accepted annotations of this type" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("A backfill of this type is already running");
    expect(screen.getByRole("link", { name: "Follow in Jobs" })).toHaveAttribute(
      "href",
      "/jobs?project=library&job=j-existing",
    );
  });

  // Controller ruling P13: 422 `not_a_defect` shows the server's own message.
  it("shows the server's message when the type is not a defect", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/catalogue\/types\/[^/]+\/backfill$/,
        status: 422,
        body: errorBody("not_a_defect", "Excavator is not a defect type"),
      },
    ]);
    renderWithProviders(<BackfillOffer type={{ ...exampleTypes[0], kind: "defect" }} onDismiss={vi.fn()} />, {
      api,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create findings from accepted annotations of this type" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Excavator is not a defect type");
  });
});
