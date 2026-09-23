import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { SurveysScreen } from "./SurveysScreen";
import { exampleJob, exampleTimeline, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";

const route = `/p/${PROJECT_ID}/surveys`;
const path = "/p/:projectId/surveys";

beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

describe("SurveysScreen", () => {
  it("lists surveys newest first with the change since the previous one", async () => {
    const { api } = fakeClient([{ method: "GET", path: /survey-timeline/, body: exampleTimeline }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    const rows = await screen.findAllByRole("row");
    expect(rows[1]).toHaveTextContent("May survey");
    expect(rows[1]).toHaveTextContent("+3");
    expect(rows[2]).toHaveTextContent("April survey");
  });

  it("marks a survey counted another way and says why", async () => {
    const odd = {
      ...exampleTimeline,
      surveys: [
        exampleTimeline.surveys[0],
        {
          ...exampleTimeline.surveys[1],
          state: "not_comparable" as const,
          reason: "different model (v2, not yolo11m-coco)",
          deltas: {},
        },
      ],
    };
    const { api } = fakeClient([{ method: "GET", path: /survey-timeline/, body: odd }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    expect(await screen.findByText(/different model/)).toBeInTheDocument();
  });

  it("explains itself when there are no surveys yet", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /survey-timeline/, body: { basis: null, classes: [], surveys: [] } },
    ]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    expect(await screen.findByText(/no surveys yet/i)).toBeInTheDocument();
  });

  it("reloads when a map detection run finishes", async () => {
    const { api, requests } = fakeClient([{ method: "GET", path: /survey-timeline/, body: exampleTimeline }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    await screen.findAllByRole("row");
    const before = requests.filter((r) => r.url.includes("survey-timeline")).length;
    // The hook fires for a job it saw running, which is the sequence the event stream delivers.
    const running = { ...exampleJob, id: "j1", type: "map_detect" as const, state: "running" as const };
    act(() => useJobsStore.getState().upsert(running));
    act(() => useJobsStore.getState().upsert({ ...running, state: "succeeded", progress: 1 }));
    await screen.findAllByRole("row");
    expect(requests.filter((r) => r.url.includes("survey-timeline")).length).toBeGreaterThan(before);
  });

  it("draws the chart and hides a class when its legend entry is switched off", async () => {
    const { api } = fakeClient([{ method: "GET", path: /survey-timeline/, body: exampleTimeline }]);
    renderWithProviders(<SurveysScreen />, { api, route, path });
    expect(await screen.findByRole("img", { name: /object counts for each survey/i })).toBeInTheDocument();
    const legend = screen.getByRole("button", { name: "excavator" });
    expect(legend).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(legend);
    expect(legend).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelectorAll("polyline")).toHaveLength(0);
  });
});
