import { useEffect, useRef, useState, type ComponentType, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClassDef } from "@contract/client";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  baseRoutes,
  exampleAttachment,
  exampleFindingDetail,
  projectTypes,
  TYPE_CRACK,
  TYPE_SPALLING,
} from "@/test/findingFixtures";
import { TestApiProvider } from "@/test/render";
import { WorkspaceSeamsContext, type WorkspaceSeams } from "@/clouds/workspace/seams";
import { PinCalloutCreate, PinCalloutView, type LikelyViewsProps, type PinDraftInput } from "./PinCallout";
import type { CloudPin } from "./types";

const types = new Map(projectTypes.map((t) => [t.id, t]));
const defectTypes = projectTypes.filter((t) => t.kind === "defect");
const pin: CloudPin = {
  id: "f-1",
  number: 217,
  typeId: TYPE_SPALLING,
  severity: 4,
  status: "open",
  note: "Spall at the base of the stack, about 40 cm.",
  p: [243500, 3178000, 52.04],
  u: 0.05,
  normal: [0.7, 0.7, 0.1],
};

function FakeLikely({ point, findingId, limit }: LikelyViewsProps) {
  return (
    <p>
      likely at {point[2]} for {findingId ?? "none"} limit {limit ?? "-"}
    </p>
  );
}

function withSeams(
  ui: ReactElement,
  attachments: unknown[],
  LikelyViews: ComponentType<LikelyViewsProps> | null = null,
) {
  const { api } = fakeClient(
    baseRoutes([
      { method: "GET", path: /\/findings\/f-1$/, body: exampleFindingDetail },
      { method: "GET", path: /\/findings\/f-1\/attachments$/, body: { items: attachments } },
    ]),
  );
  const seams = {
    requestViewCapture: () => {},
    ReportViewCard: null,
    LikelyViews,
  } as unknown as WorkspaceSeams;
  return render(
    <TestApiProvider api={api}>
      <WorkspaceSeamsContext.Provider value={seams}>{ui}</WorkspaceSeamsContext.Provider>
    </TestApiProvider>,
  );
}

const view = (onClose = () => {}, onDelete = () => {}) => (
  <PinCalloutView projectId={PROJECT_ID} pin={pin} types={types} onClose={onClose} onDelete={onDelete} />
);

describe("PinCalloutView", () => {
  it("shows the number, location, type, severity, note and comment count", async () => {
    withSeams(view(), []);
    expect(screen.getByText("F-0217")).toBeInTheDocument();
    expect(screen.getByText("Z 52.0 m · NE face")).toBeInTheDocument();
    expect(screen.getByText(types.get(TYPE_SPALLING)!.name)).toBeInTheDocument();
    expect(screen.getByText(pin.note)).toHaveClass("line-clamp-4");
    const n = exampleFindingDetail.comment_count;
    await waitFor(() => expect(screen.getByText(`${n} comment${n === 1 ? "" : "s"}`)).toBeInTheDocument());
  });

  it("shows the first two attachments as thumbnails", async () => {
    const three = [0, 1, 2].map((i) => ({
      ...exampleAttachment,
      id: `a-${i}`,
      original_name: `IMG_${i}.JPG`,
    }));
    withSeams(view(), three);
    await waitFor(() => expect(screen.getAllByRole("img", { name: /IMG_/ })).toHaveLength(2));
    expect(screen.getByRole("img", { name: "IMG_0.JPG" })).toHaveAttribute(
      "src",
      expect.stringContaining("/attachments/a-0/thumbnail"),
    );
  });

  it("falls back to Likely views for this finding, two at most", async () => {
    withSeams(view(), [], FakeLikely);
    await waitFor(() => expect(screen.getByText("likely at 52.04 for f-1 limit 2")).toBeInTheDocument());
  });

  it("shows nothing in their place while the photo link is not wired", async () => {
    withSeams(view(), []);
    await waitFor(() => expect(screen.queryAllByRole("img", { name: /IMG_/ })).toHaveLength(0));
    expect(screen.queryByText(/likely at/)).toBeNull();
  });

  it("closes and deletes", async () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    withSeams(view(onClose, onDelete), []);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClose).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });
});

function Create(props: { initialTypeId: string | null; onCreate: (v: PinDraftInput) => void }) {
  const submitRef = useRef<(() => void) | null>(null);
  return (
    <PinCalloutCreate
      defectTypes={defectTypes}
      initialTypeId={props.initialTypeId}
      busy={false}
      locationText="Z 52.0 m"
      onCreate={props.onCreate}
      onCancel={() => {}}
      submitRef={submitRef}
    />
  );
}

function CreateWithCancel(props: { onCreate: (v: PinDraftInput) => void; onCancel: () => void }) {
  const submitRef = useRef<(() => void) | null>(null);
  return (
    <PinCalloutCreate
      defectTypes={defectTypes}
      initialTypeId={TYPE_SPALLING}
      busy={false}
      locationText="Z 52.0 m"
      onCreate={props.onCreate}
      onCancel={props.onCancel}
      submitRef={submitRef}
    />
  );
}

/** T6-4: the project's `ClassDef`s can load after the draft opens (async `useProjectTypes`). */
function CreateTypesLater(props: { onCreate: (v: PinDraftInput) => void; initialTypeId: string | null }) {
  const [loadedTypes, setLoadedTypes] = useState<ClassDef[]>([]);
  useEffect(() => {
    const t = setTimeout(() => setLoadedTypes(defectTypes), 0);
    return () => clearTimeout(t);
  }, []);
  const submitRef = useRef<(() => void) | null>(null);
  return (
    <PinCalloutCreate
      defectTypes={loadedTypes}
      initialTypeId={props.initialTypeId}
      busy={false}
      locationText="Z 52.0 m"
      onCreate={props.onCreate}
      onCancel={() => {}}
      submitRef={submitRef}
    />
  );
}

describe("PinCalloutCreate", () => {
  it("names a new anomaly and uses it for the draft", async () => {
    const onCreate = vi.fn();
    const created = { ...defectTypes[0], id: "new-defect", name: "Rust", default_severity: 2 };
    const onCreateType = vi.fn(async () => created);
    const submitRef = { current: null };
    withSeams(
      <PinCalloutCreate
        defectTypes={[]}
        initialTypeId={null}
        busy={false}
        locationText="Z 1.0 m"
        onCreate={onCreate}
        onCreateType={onCreateType}
        onCancel={() => {}}
        submitRef={submitRef}
      />,
      [],
    );
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "New anomaly name" }), "Rust{Enter}");
    await waitFor(() => expect(onCreateType).toHaveBeenCalledWith("Rust"));
    expect(screen.getByRole("button", { name: /Create/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ typeId: "new-defect", severity: 2 }));
  });

  it("disables Create until a type is chosen, then takes the type's default severity", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={null} onCreate={onCreate} />, []);
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /^Type:/ }));
    await userEvent.click(within(screen.getByRole("listbox")).getByText(types.get(TYPE_CRACK)!.name));
    await userEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith({
      typeId: TYPE_CRACK,
      severity: types.get(TYPE_CRACK)!.default_severity,
      note: "",
    });
  });

  it("preselects the type used last", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={TYPE_SPALLING} onCreate={onCreate} />, []);
    expect(
      screen.getByRole("button", { name: `Type: ${types.get(TYPE_SPALLING)!.name}` }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ typeId: TYPE_SPALLING }));
  });

  it("Enter picks in the open list, creates otherwise", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={null} onCreate={onCreate} />, []);
    await userEvent.click(screen.getByRole("button", { name: /^Type:/ }));
    await userEvent.keyboard("{Enter}"); // the list's filter input has focus: Enter picks the highlighted type
    expect(onCreate).not.toHaveBeenCalled();
    const note = screen.getByRole("textbox", { name: "Note" });
    await userEvent.type(note, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.type(note, "{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: defectTypes[0].id, note: "line one\nline two" }),
    );
  });

  it("Enter on the focused Cancel button cancels, not creates (T6-3 as re-ruled)", async () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    withSeams(<CreateWithCancel onCreate={onCreate} onCancel={onCancel} />, []);
    screen.getByRole("button", { name: /^Cancel/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("pick a type, Enter creates once (focus moves to the note)", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={null} onCreate={onCreate} />, []);
    await userEvent.click(screen.getByRole("button", { name: /^Type:/ }));
    await userEvent.click(within(screen.getByRole("listbox")).getByText(types.get(TYPE_CRACK)!.name));
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ typeId: TYPE_CRACK }));
  });

  it("Enter on the closed Type trigger creates once and does not reopen the list", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={TYPE_SPALLING} onCreate={onCreate} />, []);
    screen.getByRole("button", { name: /^Type:/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Enter on a severity segment creates once", async () => {
    const onCreate = vi.fn();
    withSeams(<Create initialTypeId={TYPE_SPALLING} onCreate={onCreate} />, []);
    const none = within(screen.getByRole("radiogroup", { name: "Severity" })).getAllByRole("radio")[0];
    await userEvent.click(none);
    expect(none).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ typeId: TYPE_SPALLING, severity: null }));
  });

  it("Esc in the note cancels the draft", async () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    withSeams(<CreateWithCancel onCreate={onCreate} onCancel={onCancel} />, []);
    await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "abc{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("preselects the first/last-used type once the project's types arrive after mount (T6-4)", async () => {
    const onCreate = vi.fn();
    withSeams(<CreateTypesLater onCreate={onCreate} initialTypeId={TYPE_SPALLING} />, []);
    expect(screen.getByRole("button", { name: /Create/ })).toBeDisabled();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `Type: ${types.get(TYPE_SPALLING)!.name}` }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Create/ })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ typeId: TYPE_SPALLING }));
  });
});
