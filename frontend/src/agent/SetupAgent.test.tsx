import { useState } from "react";
import { useLocation } from "react-router-dom";
import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  fakeClient,
  exampleProject,
  exampleImagePage,
  exampleSource,
  runningJob,
  errorBody,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SetupAgent } from "./SetupAgent";

const plan = {
  name: "Site detector",
  classes: ["excavator", "truck"],
  starter_model_key: "yolo26n",
  image_guidance: "Use varied angles and empty scenes.",
  labeling_query: "Find excavators and trucks",
};
const done = {
  ...runningJob,
  state: "succeeded",
  progress: 1,
  message: "Done",
  result: { model_id: "model-1" },
};
function routes(hasKey = true): FakeRoute[] {
  return [
    {
      method: "GET",
      path: /\/providers$/,
      body: {
        items: [
          {
            name: "openai",
            has_key: hasKey,
            model_name: "configured-gpt",
            requests_per_minute: 30,
            cost_per_request: 0.02,
          },
        ],
      },
    },
    {
      method: "GET",
      path: /\/starter-models$/,
      body: { items: [{ key: "yolo26n", name: "YOLO26 nano", family: "YOLO26", available: true }] },
    },
    {
      method: "POST",
      path: /\/agent\/chat$/,
      body: { message: "Here is your plan.", plan, model_name: "configured-gpt" },
    },
    { method: "POST", path: /\/projects$/, body: exampleProject },
    { method: "POST", path: /\/library\/starters\/[^/]+\/acquire$/, body: { job: done } },
    { method: "GET", path: /\/jobs\/[^/]+$/, body: done },
    { method: "POST", path: /\/sources$/, body: { source: exampleSource, job: { ...done, id: "import-1" } } },
    { method: "GET", path: /\/images$/, body: { ...exampleImagePage, next_cursor: "next-page" } },
    {
      method: "POST",
      path: /\/estimate$/,
      body: { images: 1, tiles: 4, requests: 4, estimated_cost: 0.08, cost_per_request: 0.02 },
    },
    {
      method: "POST",
      path: /\/query-runs$/,
      body: { query_run: { id: "run-1" }, job: { ...done, id: "label-1", type: "infer" } },
    },
  ];
}
function Harness() {
  const location = useLocation();
  const [open, setOpen] = useState(true);
  return (
    <>
      <output aria-label="Current location">{location.pathname}</output>
      <button onClick={() => setOpen(true)}>Reopen agent</button>
      <SetupAgent open={open} onClose={() => setOpen(false)} />
    </>
  );
}
async function chat() {
  await screen.findByText(/configured-gpt/);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Detect machinery in drone images" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Project name");
}
async function createAndImport() {
  await chat();
  fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "E:\\projects\\detector" } });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByLabelText("Image folder");
  fireEvent.change(screen.getByLabelText("Image folder"), { target: { value: "E:\\images" } });
  fireEvent.click(screen.getByRole("button", { name: "Import images" }));
  await screen.findByLabelText(`Select ${exampleImagePage.items[0].file_name}`);
}
describe("Setup agent", () => {
  it("shows the configured model and directs a missing key to settings", async () => {
    const { api, requests } = fakeClient(routes(false));
    renderWithProviders(<Harness />, { api });
    await screen.findByText(/configured-gpt/);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "App settings" })).toHaveAttribute("href", "/settings");
    expect(requests.some((r) => r.url.includes("/key"))).toBe(false);
  });
  it("retains the plan and draft across close and reopen with focus restored", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<Harness />, { api });
    await chat();
    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Edited detector" } });
    fireEvent.click(screen.getByRole("button", { name: "Close setup agent" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Reopen agent" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Project name")).toHaveValue("Edited detector");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
  it("creates once, imports, reads one bounded page, estimates and starts labeling for review", async () => {
    const { api, requests } = fakeClient(routes());
    renderWithProviders(<Harness />, { api });
    await createAndImport();
    const reads = requests.filter((r) => r.url.includes("/images?"));
    expect(reads).toHaveLength(1);
    expect(reads[0].url).toContain("limit=24");
    fireEvent.click(screen.getByLabelText(`Select ${exampleImagePage.items[0].file_name}`));
    fireEvent.click(screen.getByRole("button", { name: "Estimate first labeling" }));
    await screen.findByTestId("estimate");
    fireEvent.click(screen.getByRole("button", { name: "Start first labeling" }));
    await screen.findByRole("link", { name: "Review suggestions" });
    expect(screen.getByLabelText("Current location")).toHaveTextContent(`/p/${exampleProject.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Start another project" }));
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(screen.queryByRole("link", { name: "Review suggestions" })).toBeNull();
    expect(requests.filter((r) => r.method === "POST" && r.url === "/api/v1/projects")).toHaveLength(1);
    // The setup agent creates training projects; the starter lands in the app-wide library.
    expect(requests.find((r) => r.method === "POST" && r.url === "/api/v1/projects")?.body).toMatchObject({
      kind: "train",
    });
    expect(requests.some((r) => r.url === "/api/v1/library/starters/yolo26n/acquire")).toBe(true);
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/query-runs"))?.body).toMatchObject({
      image_ids: [exampleImagePage.items[0].id],
      provider: "openai",
      kind: "cloud_provider",
    });
    expect(requests.some((r) => r.url.includes("promote"))).toBe(false);
  });
  it("invalidates the estimate when the labeling query changes", async () => {
    const { api } = fakeClient(routes());
    renderWithProviders(<Harness />, { api });
    await createAndImport();
    fireEvent.click(screen.getByLabelText(`Select ${exampleImagePage.items[0].file_name}`));
    fireEvent.click(screen.getByRole("button", { name: "Estimate first labeling" }));
    await screen.findByTestId("estimate");
    fireEvent.change(screen.getByLabelText("Labeling instructions"), { target: { value: "Only trucks" } });
    expect(screen.queryByTestId("estimate")).toBeNull();
    fireEvent.change(screen.getByLabelText("Labeling instructions"), {
      target: { value: plan.labeling_query },
    });
    expect(screen.queryByTestId("estimate")).toBeNull();
    expect(screen.getByRole("button", { name: "Start first labeling" })).toBeDisabled();
  });
  it("keeps a created project when starter acquisition fails and retries without recreating", async () => {
    const rs = routes();
    const acquire = rs.find((r) => r.path.test("/api/v1/library/starters/yolo26n/acquire"))!;
    acquire.status = 503;
    acquire.body = errorBody("unavailable", "Starter temporarily unavailable");
    const { api, requests } = fakeClient(rs);
    renderWithProviders(<Harness />, { api });
    await chat();
    fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "E:\\project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByText(/Starter temporarily unavailable/);
    acquire.status = 200;
    acquire.body = { job: done };
    fireEvent.click(screen.getByRole("button", { name: "Retry starter download" }));
    await screen.findByLabelText("Image folder");
    expect(requests.filter((r) => r.method === "POST" && r.url === "/api/v1/projects")).toHaveLength(1);
  });
  it("requires a new estimate after provider settings refresh without losing the selected batch", async () => {
    const rs = routes();
    const { api } = fakeClient(rs);
    renderWithProviders(<Harness />, { api });
    await createAndImport();
    fireEvent.click(screen.getByLabelText(`Select ${exampleImagePage.items[0].file_name}`));
    fireEvent.click(screen.getByRole("button", { name: "Estimate first labeling" }));
    await screen.findByTestId("estimate");
    fireEvent.click(screen.getByRole("link", { name: "App settings" }));
    rs[0].body = {
      items: [
        {
          name: "openai",
          has_key: true,
          model_name: "new-priced-model",
          requests_per_minute: 30,
          cost_per_request: 0.5,
        },
      ],
    };
    fireEvent.click(screen.getByRole("button", { name: "Reopen agent" }));
    await screen.findByText(/new-priced-model/);
    expect(screen.queryByTestId("estimate")).toBeNull();
    expect(screen.getByRole("button", { name: "Start first labeling" })).toBeDisabled();
    expect(screen.getByLabelText(`Select ${exampleImagePage.items[0].file_name}`)).toBeChecked();
    expect(screen.getByLabelText("Labeling instructions")).toHaveValue(plan.labeling_query);
  });
  it("retains the unsent message after a chat failure and can retry", async () => {
    const rs = routes();
    const endpoint = rs.find((r) => r.path.test("/agent/chat"))!;
    endpoint.status = 503;
    endpoint.body = errorBody("unavailable", "Provider unavailable. Try again.");
    const { api } = fakeClient(rs);
    renderWithProviders(<Harness />, { api });
    await screen.findByText(/configured-gpt/);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Excavators please" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText(/Provider unavailable/);
    expect(screen.getByLabelText("Message")).toHaveValue("Excavators please");
    endpoint.status = 200;
    endpoint.body = { message: "Ready", plan, model_name: "configured-gpt" };
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByLabelText("Project name");
  });
  it("waits for the first opening and refreshes provider readiness after settings navigation", async () => {
    const rs = routes(false);
    const { api, requests } = fakeClient(rs);
    const view = renderWithProviders(<SetupAgent open={false} onClose={() => {}} />, { api });
    expect(requests).toHaveLength(0);
    view.unmount();
    renderWithProviders(<Harness />, { api });
    await screen.findByText(/configured-gpt/);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("link", { name: "App settings" }));
    expect(screen.getByLabelText("Current location")).toHaveTextContent("/settings");
    rs[0].body = { items: [{ name: "openai", has_key: true, model_name: "updated-model" }] };
    fireEvent.click(screen.getByRole("button", { name: "Reopen agent" }));
    await screen.findByText(/updated-model/);
    expect(screen.getByLabelText("Message")).toHaveValue("Keep this draft");
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
  it("never selects more than 24 images while paging and invalidates selection estimates", async () => {
    const rs = routes();
    const firstPage = Array.from({ length: 24 }, (_, i) => ({
      ...exampleImagePage.items[0],
      id: `image-${i}`,
      file_name: `frame-${i}.jpg`,
    }));
    rs.find((r) => r.path.test("/images"))!.body = (req) => ({
      items: req.url.includes("cursor=")
        ? [{ ...exampleImagePage.items[0], id: "last", file_name: "last.jpg" }]
        : firstPage,
      next_cursor: "next",
      total: 25,
    });
    const { api, requests } = fakeClient(rs);
    renderWithProviders(<Harness />, { api });
    await chat();
    fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "E:\\detector" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByLabelText("Image folder");
    fireEvent.change(screen.getByLabelText("Image folder"), { target: { value: "E:\\images" } });
    fireEvent.click(screen.getByRole("button", { name: "Import images" }));
    await screen.findByLabelText("Select frame-0.jpg");
    for (let i = 0; i < 24; i++) fireEvent.click(screen.getByLabelText(`Select frame-${i}.jpg`));
    fireEvent.click(screen.getByRole("button", { name: "Estimate first labeling" }));
    await screen.findByTestId("estimate");
    fireEvent.click(screen.getByRole("button", { name: "Next 24 images" }));
    expect(await screen.findByLabelText("Select last.jpg")).toBeDisabled();
    expect(requests.filter((r) => r.url.includes("/images?"))).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Refresh images" }));
    fireEvent.click(await screen.findByLabelText("Select frame-0.jpg"));
    expect(screen.queryByTestId("estimate")).toBeNull();
    fireEvent.click(screen.getByLabelText("Select frame-0.jpg"));
    expect(screen.queryByTestId("estimate")).toBeNull();
  });
  it("cancels and resumes the same labeling run without creating another or forgetting live jobs", async () => {
    const rs = routes();
    const active = { ...runningJob, id: "label-1", type: "infer" };
    rs.find((r) => r.method === "POST" && r.path.test("/query-runs"))!.body = {
      query_run: { id: "run-1" },
      job: active,
    };
    const progress = rs.find((r) => r.method === "GET" && r.path.test("/jobs/label-1"))!;
    progress.body = active;
    rs.push(
      { method: "POST", path: /\/cancel$/, body: { ...active, state: "cancelled" } },
      { method: "POST", path: /\/resume$/, body: { job: { ...done, id: "label-1", type: "infer" } } },
    );
    const { api, requests } = fakeClient(rs);
    renderWithProviders(<Harness />, { api });
    await createAndImport();
    fireEvent.click(screen.getByLabelText(`Select ${exampleImagePage.items[0].file_name}`));
    fireEvent.click(screen.getByRole("button", { name: "Estimate first labeling" }));
    await screen.findByTestId("estimate");
    fireEvent.click(screen.getByRole("button", { name: "Start first labeling" }));
    await screen.findByRole("button", { name: "Cancel first labeling" });
    expect(screen.getByRole("button", { name: "Start another project" })).toBeDisabled();
    progress.body = { ...active, state: "cancelled" };
    fireEvent.click(screen.getByRole("button", { name: "Cancel first labeling" }));
    fireEvent.click(await screen.findByRole("button", { name: "Resume first labeling" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Resume first labeling" })).toBeNull());
    expect(requests.filter((r) => r.method === "POST" && r.url.endsWith("/query-runs"))).toHaveLength(1);
    expect(requests.some((r) => r.url.endsWith("/query-runs/run-1/resume"))).toBe(true);
  });
});
