import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  errorBody,
  exampleImage,
  fakeClient,
  IMAGE_ID,
  MODEL_ID,
  PROJECT_ID,
  proposalBox,
} from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useEditorStore } from "@/store/editor";
import { useEditorImage } from "./useEditorImage";

type Routes = Parameters<typeof fakeClient>[0];

const base: Routes = [
  { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
  { method: "GET", path: /\/boxes$/, body: { items: [], next_cursor: null } },
];

/** Mounts the hook and returns every distinct notice the editor showed, in order. */
function mount(routes: Routes, modelId: string | null = MODEL_ID) {
  const { api, requests } = fakeClient(routes);
  const notices: (string | null)[] = [];
  useEditorStore.subscribe((s) => {
    if (notices.at(-1) !== s.notice) notices.push(s.notice);
  });
  renderHook(() => useEditorImage(PROJECT_ID, IMAGE_ID, modelId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    ),
  });
  return { notices, requests };
}

describe("useEditorImage pre-annotation notices", () => {
  beforeEach(() => useEditorStore.getState().reset());

  it("says that the model is running, then explains an empty result", async () => {
    const { notices } = mount([
      ...base,
      { method: "POST", path: /\/preannotate$/, body: { skipped: false, model_id: MODEL_ID, items: [] } },
    ]);
    await waitFor(() => expect(notices.at(-1)).toMatch(/found nothing on this image/));
    expect(notices).toContain("Pre-annotating with the project's model…");
    expect(notices.at(-1)).toMatch(/a model trained on this project's labels will do better/);
  });

  it("counts the proposals and names the keys that handle them", async () => {
    const { notices } = mount([
      ...base,
      {
        method: "POST",
        path: /\/preannotate$/,
        body: { skipped: false, model_id: MODEL_ID, items: [proposalBox] },
      },
    ]);
    await waitFor(() =>
      expect(notices.at(-1)).toBe(
        "1 proposal from the pre-annotation model (dashed). A accepts all, R rejects all.",
      ),
    );
  });

  it("explains a busy GPU instead of calling it a failure", async () => {
    const { notices } = mount([
      ...base,
      {
        method: "POST",
        path: /\/preannotate$/,
        status: 409,
        body: errorBody("conflict", "GPU busy (training in progress); try again later"),
      },
    ]);
    await waitFor(() =>
      expect(notices.at(-1)).toBe(
        "The GPU is busy with a training or a detection run, so this image was not pre-annotated. Reopen it later.",
      ),
    );
  });

  it("stays silent without a pre-annotation model", async () => {
    const { notices, requests } = mount(base, null);
    await waitFor(() => expect(useEditorStore.getState().image).not.toBeNull());
    expect(notices.filter(Boolean)).toEqual([]);
    expect(requests.some((r) => r.url.endsWith("/preannotate"))).toBe(false);
  });
});
