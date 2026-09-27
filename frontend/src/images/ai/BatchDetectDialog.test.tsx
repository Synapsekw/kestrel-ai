import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { LibraryModel } from "@contract/client";
import {
  exampleClasses,
  exampleJob,
  exampleModel,
  exampleProject,
  exampleProviders,
  fakeClient,
  PROJECT_ID,
  SOURCE_ID,
} from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { useToastStore } from "@/ui";
import { useAiStore } from "./aiStore";
import { BatchDetectDialog, useBatchRuns } from "./BatchDetectDialog";
import { BatchDetectWatch } from "./BatchDetectWatch";
import { renderAi, resetAll } from "./testing";

const model: LibraryModel = {
  ...exampleModel,
  class_names: [exampleClasses[0].name],
  class_aliases: {},
  class_map: {},
};
const routes = [
  { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  { method: "GET", path: /\/library\/models$/, body: { items: [model], next_cursor: null } },
  { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
  {
    method: "POST",
    path: /\/images\/detect-batch$/,
    status: 202,
    body: { query_run: { id: "q1" }, job: { ...exampleJob, type: "infer", state: "queued" } },
  },
];

beforeEach(() => {
  resetAll();
  useJobsStore.setState({ jobs: {} });
});

describe("BatchDetectDialog", () => {
  it("queues a local model over the scope and tracks the job", async () => {
    const onClose = vi.fn();
    const { api, requests } = fakeClient(routes);
    renderAi(
      <BatchDetectDialog
        projectId={PROJECT_ID}
        open
        onClose={onClose}
        scope={{ source_id: SOURCE_ID }}
        scopeLabel="Flight 14 Sep"
        scopeCount={312}
      />,
      api,
    );
    const start = await screen.findByRole("button", { name: "Detect on 312 images" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await act(async () => {});
    expect(requests.find((r) => r.url.endsWith("/detect-batch"))?.body).toEqual({
      kind: "local_model",
      model_id: model.id,
      conf: 0.25,
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      scope: { source_id: SOURCE_ID },
    });
    expect(useJobsStore.getState().jobs[exampleJob.id]).toBeTruthy();
    expect(onClose).toHaveBeenCalled();
  });

  it("needs a query and an explicit cost acknowledgement for a cloud provider", async () => {
    const { api, requests } = fakeClient(routes);
    renderAi(
      <BatchDetectDialog
        projectId={PROJECT_ID}
        open
        onClose={vi.fn()}
        scope={{ image_ids: ["a", "b"] }}
        scopeLabel="2 selected"
        scopeCount={2}
      />,
      api,
    );
    fireEvent.click(await screen.findByText("More"));
    const cloudSwitch = screen.getByRole("switch", { name: "Use a cloud provider instead" });
    await waitFor(() => expect(cloudSwitch).toBeEnabled());
    fireEvent.click(cloudSwitch);
    const start = screen.getByRole("button", { name: "Detect on 2 images" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("What to look for"), { target: { value: "cracks in concrete" } });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I accept about \$/));
    expect((start as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(start);
    await act(async () => {});
    expect(requests.find((r) => r.url.endsWith("/detect-batch"))?.body).toMatchObject({
      kind: "cloud_provider",
      query: "cracks in concrete",
      scope: { image_ids: ["a", "b"] },
    });
  });
});

/** Drives the props FW would change while the dialog stays mounted. */
function Harness({ count = 2 as number | null }) {
  const [scopeCount, setScopeCount] = useState<number | null>(count);
  const [open, setOpen] = useState(true);
  const [projectId, setProjectId] = useState(PROJECT_ID);
  return (
    <>
      <button data-testid="count-5" onClick={() => setScopeCount(5)} />
      <button data-testid="toggle-open" onClick={() => setOpen((o) => !o)} />
      <button data-testid="project-2" onClick={() => setProjectId("p2")} />
      <BatchDetectDialog
        projectId={projectId}
        open={open}
        onClose={vi.fn()}
        scope={{ image_ids: ["a", "b"] }}
        scopeLabel="scope"
        scopeCount={scopeCount}
      />
    </>
  );
}
async function cloudReady() {
  fireEvent.click(await screen.findByText("More"));
  const cloudSwitch = screen.getByRole("switch", { name: "Use a cloud provider instead" });
  await waitFor(() => expect(cloudSwitch).toBeEnabled());
  fireEvent.click(cloudSwitch);
  fireEvent.change(screen.getByLabelText("What to look for"), { target: { value: "cracks" } });
}
const startButton = () => screen.getByRole("button", { name: /^Detect on / }) as HTMLButtonElement;

describe("BatchDetectDialog cost acknowledgement (I3, M4)", () => {
  it("asks again when the amount changes", async () => {
    renderAi(<Harness />, fakeClient(routes).api);
    await cloudReady();
    fireEvent.click(screen.getByLabelText("I accept about $0.04 of charges to my Anthropic account"));
    expect(startButton().disabled).toBe(false);
    fireEvent.click(screen.getByTestId("count-5"));
    expect(startButton().disabled).toBe(true);
    expect(
      (screen.getByLabelText("I accept about $0.10 of charges to my Anthropic account") as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("asks again when the dialog is opened again", async () => {
    renderAi(<Harness />, fakeClient(routes).api);
    await cloudReady();
    fireEvent.click(screen.getByLabelText(/I accept about \$/));
    expect(startButton().disabled).toBe(false);
    fireEvent.click(screen.getByTestId("toggle-open"));
    fireEvent.click(screen.getByTestId("toggle-open"));
    fireEvent.click(await screen.findByText("More")); // the dialog kept "cloud" and the query
    expect(startButton().disabled).toBe(true);
    expect((screen.getByLabelText(/I accept about \$/) as HTMLInputElement).checked).toBe(false);
  });

  it("says the cost depends on the filter when the count is unknown", async () => {
    renderAi(<Harness count={null} />, fakeClient(routes).api);
    await cloudReady();
    expect(screen.getByLabelText("I accept charges; the cost depends on the filter")).toBeTruthy();
    expect(screen.queryByText(/about \$/)).toBeNull();
  });
});

describe("BatchDetectDialog model and overlay", () => {
  it("re-seeds the model from the new project's last choice (M7)", async () => {
    const other = { ...model, id: "m-2", name: "second" };
    localStorage.setItem("kestrel.images.detectModel.p2", "m-2");
    const { api } = fakeClient([
      routes[0],
      { method: "GET", path: /\/library\/models$/, body: { items: [model, other], next_cursor: null } },
      routes[2],
    ]);
    renderAi(<Harness />, api);
    const select = (await screen.findByLabelText("Library model")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(model.id));
    fireEvent.click(screen.getByTestId("project-2"));
    await waitFor(() => expect(select.value).toBe("m-2"));
  });

  it("marks FA's batch overlay open while it is open (M8)", async () => {
    renderAi(<Harness />, fakeClient(routes).api);
    await screen.findByText("More");
    expect(useAiStore.getState().batchOpen).toBe(true);
    fireEvent.click(screen.getByTestId("toggle-open"));
    expect(useAiStore.getState().batchOpen).toBe(false);
  });
});

describe("BatchDetectWatch", () => {
  it("toasts the finished run with Review suggestions →", async () => {
    const onReview = vi.fn();
    const { api } = fakeClient(routes);
    renderAi(
      <>
        <BatchDetectDialog
          projectId={PROJECT_ID}
          open
          onClose={vi.fn()}
          scope={{ source_id: SOURCE_ID }}
          scopeLabel="x"
          scopeCount={3}
        />
        <BatchDetectWatch onReview={onReview} />
      </>,
      api,
    );
    const start = await screen.findByRole("button", { name: "Detect on 3 images" });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await act(async () => {});
    act(() =>
      useJobsStore
        .getState()
        .upsert({ ...exampleJob, type: "infer", state: "succeeded", result: { boxes: 42 } }),
    );
    const t = useToastStore.getState().toasts.at(-1)!;
    expect(t.text).toBe("Detection finished: 42 suggestions");
    t.action!.onClick();
    expect(onReview).toHaveBeenCalled();
  });

  it("says 1 suggestion in the singular (M5)", async () => {
    const { api } = fakeClient(routes);
    renderAi(<BatchDetectWatch onReview={vi.fn()} />, api);
    act(() => useBatchRuns.getState().add(exampleJob.id));
    act(() =>
      useJobsStore
        .getState()
        .upsert({ ...exampleJob, type: "infer", state: "succeeded", result: { boxes: 1 } }),
    );
    expect(useToastStore.getState().toasts.at(-1)!.text).toBe("Detection finished: 1 suggestion");
  });

  it("hands its runs to the global toast on unmount; a remount does not report them again (M5)", async () => {
    const { api } = fakeClient(routes);
    const first = renderAi(<BatchDetectWatch onReview={vi.fn()} />, api);
    act(() => useBatchRuns.getState().add(exampleJob.id));
    act(() => useJobsStore.getState().upsert({ ...exampleJob, type: "infer", state: "running" }));
    first.unmount();
    expect(useBatchRuns.getState().ids).toEqual([]);
    act(() =>
      useJobsStore
        .getState()
        .upsert({ ...exampleJob, type: "infer", state: "succeeded", result: { boxes: 4 } }),
    );
    renderAi(<BatchDetectWatch onReview={vi.fn()} />, api);
    expect(useToastStore.getState().toasts.some((t) => t.text.startsWith("Detection finished"))).toBe(false);
  });
});
