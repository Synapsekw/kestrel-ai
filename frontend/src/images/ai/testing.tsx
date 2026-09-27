import type { ReactElement } from "react";
import type { ApiClient, Box, ImageDetail } from "@contract/client";
import { exampleClasses, PROJECT_ID, proposalBox } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { makeDetail, makeShape } from "@/images/canvas/testing"; // I-FC's helpers
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { useAiStore } from "./aiStore";
import { useImagesWorkspace, wsGet } from "./bridge";
import { INITIAL_SAM } from "./sam/session";
import { useSamStore } from "./sam/useSmartPolygon";

export function suggestion(id: string, conf: number, o: Partial<Box> = {}): Box {
  return makeShape({
    id,
    confidence: conf,
    review_state: "unreviewed",
    reviewed_at: null,
    provenance: proposalBox.provenance,
    class_id: proposalBox.class_id,
    ...o,
  });
}

export function accepted(id: string, o: Partial<Box> = {}): Box {
  return makeShape({ id, review_state: "accepted", ...o });
}

/**
 * A fresh FC store with the project's types and one image holding `boxes`.
 *
 * G1 (drift.md): FC's `reset()` only clears per-image state; `threshold`, `showSuggestions`,
 * `showAnnotations`, `tool`, `activeTypeId`, `draft` and `viewport` survive it and would leak
 * between tests in the same file. Reset those explicitly.
 */
export function seedWorkspace(boxes: Box[], detail: ImageDetail = makeDetail()): void {
  wsGet().reset();
  useImagesWorkspace.setState({
    threshold: 0,
    showSuggestions: true,
    showAnnotations: true,
    tool: "select",
    activeTypeId: null,
    draft: null,
    viewport: { width: 0, height: 0 },
    projectId: PROJECT_ID,
    types: exampleClasses,
  });
  wsGet().loadImage(
    detail,
    boxes.map((b) => ({ ...b, image_id: detail.id })),
    [],
  );
}

export function resetAll(): void {
  useAiStore.getState().reset();
  useSamStore.setState({ state: INITIAL_SAM, handle: null });
  useToastStore.getState().clear();
  useChangesStore.setState({ findingsRevision: 0 });
  localStorage.clear();
}

export function renderAi(ui: ReactElement, api: ApiClient) {
  return renderWithProviders(ui, { api });
}
