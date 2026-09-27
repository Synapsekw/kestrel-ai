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
import { BatchDetectDialog } from "./BatchDetectDialog";
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
});
