import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { TypeEditor, type TypeEditorProps } from "./TypeEditor";

const crack = exampleTypes[2];

function renderEditor(props: Partial<TypeEditorProps> = {}, routes: FakeRoute[] = []) {
  const { api, requests } = fakeClient(routes);
  const onSaved = vi.fn();
  const onUseExisting = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <TypeEditor
      type={null}
      types={exampleTypes}
      onSaved={onSaved}
      onUseExisting={onUseExisting}
      onClose={onClose}
      {...props}
    />,
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
