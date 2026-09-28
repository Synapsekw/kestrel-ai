import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCallback, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Box, ClassDef } from "@contract/client";
import {
  ANNOTATION_ID,
  exampleFinding,
  typedProject,
  TYPE_EXCAVATOR,
  TYPE_SPALLING,
} from "@/test/findingFixtures";
import { fakeClient, IMAGE_ID, personBox, PROJECT_ID, proposalBox } from "@/test/fixtures";
import { TestApiProvider } from "@/test/render";
import { inspectorState } from "./inspectorState";
import { useInspectorModel } from "./useInspectorModel";

const types = new Map<string, ClassDef>(typedProject.classes.map((c) => [c.id, c]));
const defect = { ...personBox, id: ANNOTATION_ID, class_id: TYPE_SPALLING } as Box;
const object = { ...personBox, id: "obj", class_id: TYPE_EXCAVATOR } as Box;
const pending = { ...proposalBox, id: "sug", class_id: TYPE_SPALLING, review_state: "unreviewed" } as Box;
const boxes: Record<string, Box> = { [ANNOTATION_ID]: defect, obj: object, sug: pending };
const findingOf = (id: string) => (id === ANNOTATION_ID ? "f1" : null);
const base = { selectedId: null as string | null, boxes, types, findingOf };

describe("inspectorState", () => {
  it("nothing selected shows the image", () => expect(inspectorState(base)).toEqual({ kind: "image" }));
  it("a defect with its finding", () =>
    expect(inspectorState({ ...base, selectedId: ANNOTATION_ID })).toEqual({
      kind: "finding",
      findingId: "f1",
      box: defect,
    }));
  it("a defect whose finding is not known yet", () =>
    expect(inspectorState({ ...base, selectedId: ANNOTATION_ID, findingOf: () => null })).toMatchObject({
      kind: "pending-finding",
    }));
  it("an accepted object", () =>
    expect(inspectorState({ ...base, selectedId: "obj" })).toMatchObject({ kind: "object" }));
  it("a selected unreviewed suggestion", () =>
    expect(inspectorState({ ...base, selectedId: "sug" })).toEqual({ kind: "suggestion", box: pending }));
  it("a rejected proposal shows the image", () =>
    expect(
      inspectorState({
        ...base,
        boxes: { sug: { ...pending, review_state: "rejected" } },
        selectedId: "sug",
      }),
    ).toEqual({ kind: "image" }));
  it("an unknown id shows the image", () =>
    expect(inspectorState({ ...base, selectedId: "gone" })).toEqual({ kind: "image" }));
});

const links: Record<string, string> = { sug2: "f9" }; // FA's accept already linked sug2
const frameIn = { id: IMAGE_ID }; // one object: FC's store hands back the same frame until a new load
vi.mock("./seams", () => ({
  useSelection: () => ({ selectedId: ANNOTATION_ID, select: vi.fn(), boxes, boxesLoaded: true }),
  // A real Zustand `findingOf` selector hands back a new object once `linkFindings` sets new state,
  // which is what re-triggers useInspectorModel's memo; this double reproduces that reactivity with
  // its own state instead of mutating one fixed object in place (which would never invalidate it).
  // `linkFindings` is a stable callback (like a Zustand action) and only sets new state when a link
  // actually changed, so useInspectorModel's effect (deps: [frame, items, linkFindings]) settles instead of
  // looping.
  useFindingLinks: () => {
    // A copy, not an alias: `links` is mutated in place below (for the test's own assertions),
    // and an alias would make `prev` already reflect that mutation before the state comparison runs.
    const [current, setCurrent] = useState<Record<string, string>>(() => ({ ...links }));
    const linkFindings = useCallback((l: Record<string, string>) => {
      Object.assign(links, l);
      setCurrent((prev) => (Object.entries(l).every(([k, v]) => prev[k] === v) ? prev : { ...prev, ...l }));
    }, []);
    // The frame is in FC's store (C1: the model links only once it is).
    return { findingOf: current, linkFindings, loaded: frameIn };
  },
}));

describe("useInspectorModel", () => {
  it("reads one bounded page of this image's findings and maps boxes to findings", async () => {
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
    await waitFor(() => expect(result.current.state.kind).toBe("finding"));
    const url = requests.find((r) => r.url.includes("/findings?"))!.url;
    expect(url).toContain(`image_id=${IMAGE_ID}`);
    expect(url).toContain("limit=500");
    expect(result.current.findingIdOf(ANNOTATION_ID)).toBe(exampleFinding.id);
    expect(result.current.findingIdOf("sug2")).toBe("f9"); // FA's own accept, kept in FC's store
    expect(links[ANNOTATION_ID]).toBe(exampleFinding.id); // this page was linked into FC's store
    expect(result.current.findingIdOf("nothing")).toBeNull();
  });
});
