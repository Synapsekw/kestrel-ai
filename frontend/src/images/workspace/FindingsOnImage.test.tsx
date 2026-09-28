import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Box, ClassDef } from "@contract/client";
import { ANNOTATION_ID, exampleFinding, typedProject, TYPE_EXCAVATOR } from "@/test/findingFixtures";
import { PROJECT_ID, personBox } from "@/test/fixtures";
import { FindingsOnImage } from "./FindingsOnImage";

const types = new Map<string, ClassDef>(typedProject.classes.map((c) => [c.id, c]));
const polygon = { ...personBox, id: ANNOTATION_ID, shape: "polygon" } as Box;
const obj = {
  ...personBox,
  id: "obj",
  class_id: TYPE_EXCAVATOR,
  review_state: "accepted",
  confidence: 0.91,
  provenance: { kind: "local_model", model_id: "m1", provider: null, model_name: "yolo", query_run_id: null },
} as Box;

function setup(more = false) {
  const onSelect = vi.fn();
  render(
    <MemoryRouter>
      <FindingsOnImage
        projectId={PROJECT_ID}
        findings={[exampleFinding]}
        more={more}
        boxes={{ [ANNOTATION_ID]: polygon, obj }}
        types={types}
        selectedId={null}
        onSelect={onSelect}
      />
    </MemoryRouter>,
  );
  return onSelect;
}

describe("FindingsOnImage", () => {
  it("lists findings then accepted objects, and selects on click", async () => {
    const onSelect = setup();
    expect(screen.getByText("Findings on this image · 1")).toBeInTheDocument();
    const rows = screen.getAllByRole("button", { pressed: false });
    expect(rows[0]).toHaveTextContent("F-0217 · polygon · Open");
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows[1]).toHaveTextContent("Object");
    expect(rows[1]).toHaveTextContent("91%");
    await userEvent.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith(ANNOTATION_ID);
  });
  it("says 1+ past one page and links to the Findings tab", () => {
    setup(true);
    expect(screen.getByText("Findings on this image · 1+")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Findings →" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/findings?anchor_kind=image`,
    );
  });
});
