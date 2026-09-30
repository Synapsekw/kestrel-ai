import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { CatalogueType } from "@/api/catalogue";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext, type SeverityLevel } from "@/ui";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { TypeEditor, type TypeEditorProps } from "./TypeEditor";

const crack = exampleTypes[2];

function renderEditor(
  props: Partial<TypeEditorProps> = {},
  routes: FakeRoute[] = [],
  scale: readonly SeverityLevel[] = DEFAULT_SEVERITY_SCALE,
) {
  const { api, requests } = fakeClient(routes);
  const onSaved = vi.fn();
  const onUseExisting = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <SeverityScaleContext.Provider value={scale}>
      <TypeEditor
        type={null}
        types={exampleTypes}
        onSaved={onSaved}
        onUseExisting={onUseExisting}
        onClose={onClose}
        {...props}
      />
    </SeverityScaleContext.Provider>,
    { api },
  );
  return { requests, onSaved, onUseExisting, onClose };
}

// The severity picker reads DS's context, whose default is D4's scale (Minor … Critical).
describe("TypeEditor", () => {
  it("creates a defect with a default severity", async () => {
    const created = { ...crack, id: "new", name: "Rust", default_severity: 3 };
    const { requests, onSaved } = renderEditor({}, [
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: created },
    ]);
    expect(screen.getByRole("heading", { name: "New type" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rust" } });
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created, false));
    expect(requests[0].body).toEqual({
      name: "Rust",
      colour: "#eab308",
      kind: "defect",
      group: null,
      default_severity: 3,
      hotkey: null,
    });
  });

  it("refuses a name that normalises to an existing type and opens that one", () => {
    const { requests, onUseExisting } = renderEditor();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "dump-truck" } });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    expect(
      screen.getByText('"Dump truck" already exists. Open it instead of creating a second one.'),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    expect(onUseExisting).toHaveBeenCalledWith(TYPE_ID(2));
  });

  it("offers the existing type when the server answers type_exists", async () => {
    const { onUseExisting } = renderEditor({}, [
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "exists", { type_id: TYPE_ID(4) }),
      },
    ]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spall" } });
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    expect(await screen.findByText("A type with this name already exists.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use existing" }));
    expect(onUseExisting).toHaveBeenCalledWith(TYPE_ID(4));
  });

  it("says findings are kept when a defect becomes an object, and drops the severity", () => {
    renderEditor({ type: crack });
    expect(screen.getByRole("heading", { name: "Crack" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Object" }));
    expect(
      screen.getByText("Findings of this type are kept. No new findings will be created from it."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Objects are counted, not graded, so they have no severity."),
    ).toBeInTheDocument();
  });

  it("passes the backfill flag on from an object -> defect save", async () => {
    const excavator = exampleTypes[0];
    const { requests, onSaved } = renderEditor({ type: excavator }, [
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...excavator, kind: "defect", backfill_candidates: true },
      },
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Defect" }));
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...excavator, kind: "defect" }, true));
    expect(requests[0].body).toEqual({ kind: "defect" });
  });

  it("archives a type", async () => {
    const { requests, onSaved } = renderEditor({ type: crack }, [
      { method: "PATCH", path: /\/catalogue\/types\/[^/]+$/, body: { ...crack, archived: true } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ...crack, archived: true }, false));
    expect(requests[0].body).toEqual({ archived: true });
  });

  it("closes without a request when nothing changed", () => {
    const { requests, onClose } = renderEditor({ type: crack });
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    expect(onClose).toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
});

describe("TypeEditor: definition and severity rules", () => {
  const PATCH_ECHO: FakeRoute = {
    method: "PATCH",
    path: /\/catalogue\/types\/[^/]+$/,
    body: (r) => ({ ...crack, ...(r.body as object), backfill_candidates: false }),
  };
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save type" }));

  it("creates a type with a definition and its rules in the order shown", async () => {
    const { requests, onSaved } = renderEditor({}, [
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 201,
        body: (r) => ({ ...crack, id: "new", ...(r.body as object) }),
      },
    ]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rust" } });
    fireEvent.change(screen.getByLabelText("Definition"), {
      target: { value: " Orange-brown flaking on steel. " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByLabelText("Rule 1 condition"), {
      target: { value: "Surface staining only" },
    });
    fireEvent.change(screen.getByLabelText("Rule 1 severity"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByLabelText("Rule 2 condition"), {
      target: { value: "Section loss visible" },
    });
    fireEvent.change(screen.getByLabelText("Rule 2 severity"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Create type" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[0].body).toMatchObject({
      name: "Rust",
      definition: "Orange-brown flaking on steel.",
      severity_rules: [
        { when: "Section loss visible", severity: 4 },
        { when: "Surface staining only", severity: 1 },
      ],
    });
  });

  it("mentions the Alt+arrow shortcut only once there are two rules to reorder", () => {
    renderEditor();
    const hint = /Alt\+↑ and Alt\+↓ move the focused rule/;
    expect(screen.getByText(/Read in this order to suggest a severity/)).toBeInTheDocument();
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it("counts the definition's characters against 1000", () => {
    renderEditor();
    expect(screen.getByText("0 / 1000")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Definition"), { target: { value: "Rust" } });
    expect(screen.getByText("4 / 1000")).toBeInTheDocument();
    expect(screen.getByLabelText("Definition")).toHaveAttribute("maxlength", "1000");
  });

  it("patches only the definition when only it changed", async () => {
    const { requests } = renderEditor({ type: crack }, [PATCH_ECHO]);
    fireEvent.change(screen.getByLabelText("Definition"), { target: { value: "A linear fracture." } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ definition: "A linear fracture." });
  });

  it("clearing the definition sends null", async () => {
    const described: CatalogueType = { ...crack, definition: "A linear fracture." };
    const { requests } = renderEditor({ type: described }, [PATCH_ECHO]);
    expect(screen.getByLabelText("Definition")).toHaveValue("A linear fracture.");
    fireEvent.change(screen.getByLabelText("Definition"), { target: { value: "" } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ definition: null });
  });

  it("saves a name change on a type from before 0003 without touching definition or rules", async () => {
    const old: CatalogueType = { ...crack, definition: null, severity_rules: [] };
    const { requests } = renderEditor({ type: old }, [PATCH_ECHO]);
    expect(screen.getByLabelText("Definition")).toHaveValue("");
    expect(
      screen.getByText("No rules yet. Add one to say which severity fits which condition."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hairline crack" } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ name: "Hairline crack" });
  });

  it("hides definition and rules for an answer without them and never sends them", async () => {
    const legacy: Partial<CatalogueType> = { ...crack };
    delete legacy.definition;
    delete legacy.severity_rules;
    const { requests } = renderEditor({ type: legacy as CatalogueType }, [PATCH_ECHO]);
    expect(screen.queryByLabelText("Definition")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add rule" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hairline crack" } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ name: "Hairline crack" });
  });

  it("sends the whole reordered list when a rule moves", async () => {
    const ruled: CatalogueType = {
      ...crack,
      severity_rules: [
        { when: "Hairline", severity: 1 },
        { when: "Wider than 5 mm", severity: 4 },
      ],
    };
    const { requests } = renderEditor({ type: ruled }, [PATCH_ECHO]);
    fireEvent.keyDown(screen.getByLabelText("Rule 2 condition"), { key: "ArrowUp", altKey: true });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({
      severity_rules: [
        { when: "Wider than 5 mm", severity: 4 },
        { when: "Hairline", severity: 1 },
      ],
    });
  });

  it("a rule on a removed level does not block a rename", async () => {
    const graded: CatalogueType = { ...crack, severity_rules: [{ when: "Wider than 5 mm", severity: 4 }] };
    const { requests } = renderEditor({ type: graded }, [PATCH_ECHO], DEFAULT_SEVERITY_SCALE.slice(0, 3));
    expect(
      screen.getByText("Level 4 is no longer on the severity scale. Choose another level."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Structural crack" } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].body).toEqual({ name: "Structural crack" });
  });

  it("a rules change waits until the removed level is replaced", async () => {
    const graded: CatalogueType = { ...crack, severity_rules: [{ when: "Wider than 5 mm", severity: 4 }] };
    const { requests } = renderEditor({ type: graded }, [PATCH_ECHO], DEFAULT_SEVERITY_SCALE.slice(0, 3));
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByLabelText("Rule 2 condition"), { target: { value: "Hairline" } });
    save();
    expect(
      screen.getByText(
        "Rule 1 uses level 4, which is no longer on the severity scale. Choose another level.",
      ),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Rule 1 severity"), { target: { value: "3" } });
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    // Crack's default severity is 2, which is on the 3-level scale, so the added rule starts there.
    expect(requests[0].body).toEqual({
      severity_rules: [
        { when: "Wider than 5 mm", severity: 3 },
        { when: "Hairline", severity: 2 },
      ],
    });
  });

  it("refuses an empty rule condition before sending", () => {
    const { requests } = renderEditor({ type: crack }, [PATCH_ECHO]);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    save();
    expect(
      screen.getByText("Rule 1 needs a condition. Say when it applies, or remove it."),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("explains a server refusal of the rules", async () => {
    renderEditor({ type: crack }, [
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        status: 422,
        body: errorBody("invalid_severity_rule", "severity 5 is not a level on the scale"),
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByLabelText("Rule 1 condition"), { target: { value: "Wide" } });
    save();
    expect(
      await screen.findByText(
        "A rule uses a severity level that is not on the scale. Choose another level for it, then save.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the definition and rules for an object too", () => {
    renderEditor({ type: exampleTypes[0] });
    expect(screen.getByLabelText("Definition")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add rule" })).toBeInTheDocument();
  });
});
