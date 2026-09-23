import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { StarterModel } from "@contract/client";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { StarterModels } from "./StarterModels";

const starters: StarterModel[] = [
  {
    key: "yolo11n",
    name: "YOLO11 nano",
    family: "YOLO11",
    description: "Fast.",
    size_mb: 5,
    available: true,
  },
  {
    key: "yolo26x",
    name: "YOLO26 extra large",
    family: "YOLO26",
    description: "More memory.",
    size_mb: 0,
    available: false,
  },
];
const starterJob = { ...runningJob, project_id: "library", type: "library_starter" as const };

describe("StarterModels", () => {
  it("selects another family and starts a library job for just the chosen model", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/library\/starters\/[^/]+\/acquire$/,
        status: 202,
        body: { job: starterJob },
      },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(<StarterModels existingNames={[]} onStarted={onStarted} />, { api });
    fireEvent.change(await screen.findByLabelText("Model family"), { target: { value: "YOLO26" } });
    expect(screen.getByLabelText("Starter model")).toHaveValue("yolo26x");
    fireEvent.click(screen.getByRole("button", { name: "Download and add YOLO26 extra large" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(starterJob));
    expect(requests.filter((r) => r.method === "POST")).toEqual([
      expect.objectContaining({ url: "/api/v1/library/starters/yolo26x/acquire", body: {} }),
    ]);
  });

  it("marks a starter that is already in the library", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    ]);
    renderWithProviders(<StarterModels existingNames={["yolo11n-coco"]} onStarted={() => {}} />, { api });
    expect(await screen.findByText("In the library")).toBeInTheDocument();
    expect(screen.getByText("5 MB · Ready on this computer")).toBeInTheDocument();
  });

  it("shows the reason when the job cannot start", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/acquire$/,
        status: 503,
        body: errorBody("library_unavailable", "the library could not be opened"),
      },
    ]);
    renderWithProviders(<StarterModels existingNames={[]} onStarted={() => {}} />, { api });
    fireEvent.click(await screen.findByRole("button", { name: "Add YOLO11 nano" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("the library could not be opened");
    expect(screen.getByRole("button", { name: "Add YOLO11 nano" })).toBeEnabled();
  });
});
