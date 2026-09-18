import { describe, it, expect, beforeEach } from "vitest";
import { exampleImage, personBox, proposalBox } from "@/test/fixtures";
import { selectedBox, useEditorStore, visibleBoxes, visibleProposalIds, waitForIdle } from "./editor";

const rejected = {
  ...proposalBox,
  id: "b-rej",
  review_state: "rejected" as const,
  created_at: "2026-09-17T12:00:00Z",
};

describe("editor store", () => {
  beforeEach(() => {
    // `reset` keeps the viewport on purpose (the canvas stays mounted between images), so the
    // tests clear it explicitly to start from a store that has never been measured.
    useEditorStore.getState().reset();
    useEditorStore.setState({ viewport: { width: 0, height: 0 }, activeClassId: null, showRejected: false });
  });

  it("loads an image with boxes ordered by creation time and fits once the viewport is known", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, [proposalBox, personBox]);
    const st = useEditorStore.getState();
    expect(st.imageId).toBe(exampleImage.id);
    expect(st.order).toEqual([personBox.id, proposalBox.id]);
    expect(st.fitted).toBe(true);
    expect(st.view.scale).toBeLessThan(1);
    expect(st.view.scale).toBeCloseTo(Math.min(968 / 4000, 668 / 2667), 6);
  });

  it("fits when the viewport arrives after the image", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, []);
    expect(useEditorStore.getState().fitted).toBe(false);
    s.setViewport({ width: 800, height: 600 });
    expect(useEditorStore.getState().fitted).toBe(true);
    expect(useEditorStore.getState().view.scale).toBeCloseTo(768 / 4000, 6);
  });

  it("upserts, removes and patches review states", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, [personBox]);
    s.upsertBox(proposalBox);
    expect(useEditorStore.getState().order).toEqual([personBox.id, proposalBox.id]);
    s.upsertBox({ ...proposalBox, x: 1 });
    expect(useEditorStore.getState().boxes[proposalBox.id].x).toBe(1);
    expect(useEditorStore.getState().order).toHaveLength(2);
    s.patchStates([proposalBox.id], "accepted");
    expect(useEditorStore.getState().boxes[proposalBox.id].review_state).toBe("accepted");
    expect(useEditorStore.getState().boxes[proposalBox.id].reviewed_at).not.toBeNull();
    s.select(proposalBox.id);
    s.removeBox(proposalBox.id);
    expect(useEditorStore.getState().order).toEqual([personBox.id]);
    expect(useEditorStore.getState().selectedId).toBeNull();
  });

  it("hides rejected boxes unless asked and lists visible proposals", () => {
    const s = useEditorStore.getState();
    s.loadImage(exampleImage, [personBox, proposalBox, rejected]);
    expect(visibleBoxes(useEditorStore.getState()).map((b) => b.id)).toEqual([personBox.id, proposalBox.id]);
    expect(visibleProposalIds(useEditorStore.getState())).toEqual([proposalBox.id]);
    s.toggleShowRejected();
    expect(visibleBoxes(useEditorStore.getState())).toHaveLength(3);
    s.select(personBox.id);
    expect(selectedBox(useEditorStore.getState())?.id).toBe(personBox.id);
  });

  it("zooms around a display point and sets 1:1", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, []);
    const before = useEditorStore.getState().view.scale;
    s.zoomAt({ x: 500, y: 350 }, 2);
    expect(useEditorStore.getState().view.scale).toBeCloseTo(before * 2, 9);
    s.oneToOne();
    expect(useEditorStore.getState().view.scale).toBe(1);
    s.fit();
    expect(useEditorStore.getState().view.scale).toBeCloseTo(before, 9);
  });

  it("counts pending requests and resolves waitForIdle", async () => {
    const s = useEditorStore.getState();
    s.beginRequest();
    s.beginRequest();
    let idle = false;
    const p = waitForIdle(useEditorStore).then(() => {
      idle = true;
    });
    s.endRequest();
    await Promise.resolve();
    expect(idle).toBe(false);
    s.endRequest();
    await p;
    expect(idle).toBe(true);
    expect(useEditorStore.getState().pending).toBe(0);
  });

  it("reset clears everything but keeps the viewport", () => {
    const s = useEditorStore.getState();
    s.setViewport({ width: 1000, height: 700 });
    s.loadImage(exampleImage, [personBox]);
    s.setActiveClass("c1");
    s.setError("x");
    s.reset();
    const st = useEditorStore.getState();
    expect(st.image).toBeNull();
    expect(st.order).toEqual([]);
    expect(st.error).toBeNull();
    expect(st.activeClassId).toBe("c1");
    expect(st.viewport).toEqual({ width: 1000, height: 700 });
  });
});
