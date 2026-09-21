import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { StarterModel } from "@contract/client";
import { exampleJob, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
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
const done = {
  ...exampleJob,
  type: "import",
  state: "succeeded",
  params: { purpose: "starter_model" },
  result: { model_id: exampleModel.id },
};

describe("StarterModels", () => {
  it("selects another family and downloads just the chosen model in a background job", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      { method: "POST", path: /\/models\/acquire-starter$/, status: 202, body: { job: done } },
      { method: "GET", path: /\/models\/[^/]+$/, body: exampleModel },
    ]);
    const onImported = vi.fn();
    renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={onImported} />, {
      api,
    });
    fireEvent.change(await screen.findByLabelText("Model family"), { target: { value: "YOLO26" } });
    expect(screen.getByLabelText("Starter model")).toHaveValue("yolo26x");
    fireEvent.click(screen.getByRole("button", { name: "Download and add YOLO26 extra large" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(exampleModel));
    expect(requests.filter((r) => r.method === "POST")).toEqual([
      expect.objectContaining({ body: { key: "yolo26x" } }),
    ]);
  });

  it("shows failed background downloads and allows retry", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
      {
        method: "POST",
        path: /\/models\/acquire-starter$/,
        status: 202,
        body: { job: { ...done, state: "failed", error: "Download interrupted. Try again." } },
      },
    ]);
    renderWithProviders(
      <StarterModels projectId={PROJECT_ID} existingNames={["yolo11n-coco"]} onImported={() => {}} />,
      { api },
    );
    expect(await screen.findByText("In the registry")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add YOLO11 nano" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Download interrupted");
    expect(screen.getByRole("button", { name: "Add YOLO11 nano" })).toBeEnabled();
  });
});

it("keeps controls disabled while the background job runs and exposes cancellation", async () => {
  const running = { ...done, state: "running", progress: 0.4, message: "Downloading yolo11n" };
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    { method: "POST", path: /\/models\/acquire-starter$/, status: 202, body: { job: running } },
    { method: "POST", path: /\/cancel$/, body: { ...running, state: "cancelled" } },
  ]);
  renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={() => {}} />, {
    api,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Add YOLO11 nano" }));
  expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  expect(screen.getByLabelText("Model family")).toBeDisabled();
  expect(screen.getByRole("button", { name: /Adding/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(requests.some((r) => r.url.endsWith("/cancel"))).toBe(true));
});

it("keeps the original acquisition during a transient polling failure and reconnects", async () => {
  let polls = 0;
  const onImported = vi.fn();
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    {
      method: "POST",
      path: /\/models\/acquire-starter$/,
      status: 202,
      body: { job: { ...done, state: "running" } },
    },
    {
      method: "GET",
      path: /\/jobs\/[^/]+$/,
      body: () => {
        if (++polls === 1) throw new Error("Connection interrupted");
        return done;
      },
    },
    { method: "GET", path: /\/models\/[^/]+$/, body: exampleModel },
  ]);
  renderWithProviders(<StarterModels projectId={PROJECT_ID} existingNames={[]} onImported={onImported} />, {
    api,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Add YOLO11 nano" }));
  expect(await screen.findByRole("alert", {}, { timeout: 1800 })).toHaveTextContent("Connection interrupted");
  const adding = screen.getByRole("button", { name: /Adding/ });
  expect(adding).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  fireEvent.click(adding);
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(exampleModel), { timeout: 1800 });
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
