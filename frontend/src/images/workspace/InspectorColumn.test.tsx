import { describe, expect, it, vi } from "vitest";
import { createRef, type ReactNode } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Box } from "@contract/client";
import { ANNOTATION_ID, typedProject, TYPE_SPALLING } from "@/test/findingFixtures";
import { fakeClient, PROJECT_ID, personBox, proposalBox } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { InspectorColumn } from "./InspectorColumn";
import type { InspectorModel } from "./useInspectorModel";

const accept = vi.fn();
// Partial mock: MeasuredSize (Task 3, unmocked here) also imports "./seams" for the real
// scaleFromCamera/measureShape maths, so the FC/FA hooks this test overrides are spread onto
// the actual module rather than replacing it outright.
vi.mock("./seams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./seams")>()),
  useSelection: () => ({ selectedId: null, select: vi.fn(), boxes: {}, order: [], boxesLoaded: true }),
  useSuggestionActions: () => ({ accept, reject: vi.fn() }),
  useShapeActions: () => ({ remove: vi.fn() }),
}));
vi.mock("@/findings/FindingInspector", () => ({
  FindingInspector: (p: { findingId: string; measureSlot?: ReactNode; anchorSlot?: ReactNode }) => (
    <div data-testid="finding-inspector" data-finding={p.findingId}>
      {p.measureSlot}
      {p.anchorSlot}
    </div>
  ),
}));

const { api } = fakeClient([{ method: "GET", path: /\/projects\/[^/]+$/, body: typedProject }]);
const defect = { ...personBox, id: ANNOTATION_ID, class_id: TYPE_SPALLING, w: 100, h: 50 } as Box;
const model = (state: InspectorModel["state"]): InspectorModel => ({
  state,
  findings: [],
  more: false,
  loaded: true,
  findingIdOf: () => null,
});

function renderColumn(state: InspectorModel["state"], onShowOnImage = vi.fn()) {
  renderWithProviders(
    <InspectorColumn
      projectId={PROJECT_ID}
      model={model(state)}
      detail={null}
      onDetail={vi.fn()}
      distanceRef={createRef()}
      clouds={[]}
      onShowOnImage={onShowOnImage}
    />,
    { api },
  );
  return onShowOnImage;
}

describe("InspectorColumn", () => {
  it("hosts FindingInspector with MeasuredSize and Show on image", async () => {
    const onShow = renderColumn({ kind: "finding", findingId: "f1", box: defect });
    expect(screen.getByTestId("finding-inspector")).toHaveAttribute("data-finding", "f1");
    expect(screen.getByTestId("measured-size")).toHaveTextContent("px only");
    await userEvent.click(screen.getByRole("button", { name: "Show on image" }));
    expect(onShow).toHaveBeenCalledWith(ANNOTATION_ID);
  });
  it("shows a suggestion card whose Accept runs FA's command", async () => {
    const sug = { ...proposalBox, id: "sug", class_id: TYPE_SPALLING, confidence: 0.81 } as Box;
    renderColumn({ kind: "suggestion", box: sug });
    expect(screen.getByText("81%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(accept).toHaveBeenCalledWith("sug");
  });
  it("carries E's hook and a region name", () => {
    renderColumn({ kind: "object", box: defect });
    expect(screen.getByTestId("inspector-column")).toBe(
      screen.getByRole("region", { name: "Image inspector" }),
    );
  });
});
