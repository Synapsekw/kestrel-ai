import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Box } from "@contract/client";
import type { ImageDetail } from "@/api/images";
import { ANNOTATION_ID, exampleFinding, FINDING_ID, typedProject } from "@/test/findingFixtures";
import { exampleImage, fakeClient, IMAGE_ID, personBox, PROJECT_ID } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { useInspectorModel } from "./useInspectorModel";

/**
 * C1 (final review): the REAL FC store, not a stubbed `useFindingLinks`. FC's `loadImage` spreads
 * `PER_IMAGE` (`findingOf: {}`), so links written before the frame lands are wiped; the model must
 * relink once FC's store holds the frame it loaded.
 */
const detail = {
  ...exampleImage,
  camera: null,
  footprint: null,
  footprint_kind: "none",
} as unknown as ImageDetail;
const defect = { ...personBox, id: ANNOTATION_ID } as Box;

function mount() {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
    { method: "GET", path: /\/findings$/, body: { items: [exampleFinding], next_cursor: null } },
  ]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestApiProvider api={api}>
      <MemoryRouter>{children}</MemoryRouter>
    </TestApiProvider>
  );
  const { result } = renderHook(() => useInspectorModel(PROJECT_ID, IMAGE_ID), { wrapper });
  return { result, requests };
}

beforeEach(() => useImagesWorkspace.getState().reset());

describe("useInspectorModel links (C1)", () => {
  it("keeps the finding link when the findings page answers before FC loads the frame", async () => {
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => useImagesWorkspace.getState().loadImage(detail, [defect], []));
    await waitFor(() => expect(useImagesWorkspace.getState().findingOf[ANNOTATION_ID]).toBe(FINDING_ID));
  });

  it("relinks when FC reloads the frame its store already held (a remount on the same image)", async () => {
    act(() => useImagesWorkspace.getState().loadImage(detail, [defect], []));
    const { result } = mount();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => useImagesWorkspace.getState().loadImage({ ...detail }, [defect], []));
    await waitFor(() => expect(useImagesWorkspace.getState().findingOf[ANNOTATION_ID]).toBe(FINDING_ID));
  });

  it("links as soon as both the page and the frame are in, whichever lands first", async () => {
    act(() => useImagesWorkspace.getState().loadImage(detail, [defect], []));
    mount();
    await waitFor(() => expect(useImagesWorkspace.getState().findingOf[ANNOTATION_ID]).toBe(FINDING_ID));
  });
});
