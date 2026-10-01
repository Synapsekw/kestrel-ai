import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ApiFailure } from "@/api/errors";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SAVED, TEMPLATES, VERTICAL, VISUAL, draftBucket, typeSpec } from "@/test/setupFixtures";
import { useSetupDraft } from "./draftStore";
import { remap } from "./remap";
import { SummaryCard, type SummaryCardProps } from "./SummaryCard";

function renderSummary(props: Partial<SummaryCardProps> = {}, routes: FakeRoute[] = []) {
  const { api, requests } = fakeClient(routes);
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onTemplateSaved = vi.fn();
  renderWithProviders(
    <SummaryCard
      templates={TEMPLATES}
      catalogueAvailable
      variant="card"
      onCreate={onCreate}
      onTemplateSaved={onTemplateSaved}
      {...props}
    />,
    { api },
  );
  return { requests, onCreate, onTemplateSaved };
}

const store = () => useSetupDraft.getState();
const checklist = () => screen.getByRole("list", { name: "Setup checklist" });
const create = () => screen.getByRole("button", { name: "Create project" });

function saveAs(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Save as my template" }));
  fireEvent.change(screen.getByLabelText("Template name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Save template" }));
}

describe("SummaryCard", () => {
  beforeEach(() => store().discard());

  it("keeps Create off until the name and folder are valid", () => {
    renderSummary();
    expect(screen.getByRole("complementary", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to create" })).toBeInTheDocument();
    expect(checklist()).toHaveTextContent("Template: Blank");
    expect(checklist()).toHaveTextContent("Give the project a name.");
    expect(create()).toBeDisabled();
    act(() => store().setName("Site A"));
    expect(checklist()).toHaveTextContent("Choose a folder for the project.");
    act(() => store().setFolder("Projects\\A"));
    expect(checklist()).toHaveTextContent("Use a full folder path, such as E:\\Projects\\Site.");
    act(() => store().setFolder("E:\\Projects\\A"));
    expect(checklist()).toHaveTextContent("Name and folder");
    expect(create()).toBeEnabled();
  });

  it("warns for each empty required slot but still allows Create", () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().setName("Mast");
    store().setFolder("E:\\Projects\\Mast");
    renderSummary();
    expect(checklist()).toHaveTextContent("Template: Vertical asset inspection");
    expect(checklist()).toHaveTextContent("0 of 4 slots");
    expect(checklist()).toHaveTextContent("Visual photos is empty. You can add it later.");
    expect(checklist()).toHaveTextContent("7 anomaly types");
    expect(create()).toBeEnabled();
    act(() => store().setBuckets(remap([draftBucket(VISUAL)], VERTICAL.config.slots)));
    expect(checklist()).toHaveTextContent("1 of 4 slots");
    expect(checklist()).not.toHaveTextContent("Visual photos is empty");
  });

  it("a hotkey clash blocks Create and Save as my template", async () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().addType(typeSpec("Scaffold", "object", null, "3"));
    store().setName("Mast");
    store().setFolder("E:\\Projects\\Mast");
    const { requests } = renderSummary();
    expect(checklist()).toHaveTextContent("Hotkey 3 is used by Loose / missing bolt and Scaffold");
    expect(create()).toBeDisabled();
    expect(screen.getByText("Give each type its own hotkey to create the project.")).toBeInTheDocument();
    saveAs("Mast");
    expect(await screen.findByText("Give each type its own hotkey first.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("hands the draft to onCreate and shows a refusal in the summary, keeping the draft", async () => {
    store().setName("Site A");
    store().setFolder("E:\\Projects\\A");
    const refusal = new ApiFailure("validation_error", "request validation failed", 422, {
      errors: [{ loc: ["body", "folder"], msg: "folder already holds a project", type: "value_error" }],
    });
    const onCreate = vi.fn().mockRejectedValue(refusal);
    renderSummary({ onCreate });
    fireEvent.click(create());
    expect(await screen.findByText("folder: folder already holds a project")).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Site A", folder: "E:\\Projects\\A" }),
    );
    expect(store().name).toBe("Site A");
    expect(create()).toBeEnabled();
  });

  it("Save as my template stores the slots and types, never the name, folder or files", async () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().setName("Mast SR-0412");
    store().setFolder("E:\\Projects\\SR-0412");
    store().setBuckets(remap([draftBucket(VISUAL)], VERTICAL.config.slots));
    const saved = { ...SAVED, id: "tpl-new", name: "Mast", config: VERTICAL.config };
    const { requests, onTemplateSaved } = renderSummary({}, [
      { method: "POST", path: /\/project-templates$/, status: 201, body: saved },
    ]);
    saveAs("Mast");
    await waitFor(() => expect(onTemplateSaved).toHaveBeenCalledWith(saved));
    expect(requests[0].body).toEqual({
      name: "Mast",
      config: { config_version: 1, slots: VERTICAL.config.slots, types: VERTICAL.config.types },
    });
    expect(JSON.stringify(requests[0].body)).not.toMatch(/SR-0412|DCIM/);
  });

  it("says inline that a template name is taken", async () => {
    store().chooseTemplate(VERTICAL, "replace");
    renderSummary({}, [
      {
        method: "POST",
        path: /\/project-templates$/,
        status: 409,
        body: errorBody("template_name_taken", "a template with that name exists"),
      },
    ]);
    saveAs("Mapping and survey");
    expect(
      await screen.findByText("A template called Mapping and survey already exists. Choose another name."),
    ).toBeInTheDocument();
  });

  it("Save as my template needs the catalogue", () => {
    renderSummary({ catalogueAvailable: false });
    expect(screen.queryByRole("button", { name: "Save as my template" })).toBeNull();
  });

  it("below 1100 px: a bottom bar whose checklist opens in a popover", () => {
    renderSummary({ variant: "bar" });
    const bar = screen.getByRole("region", { name: "Summary" });
    expect(bar).toHaveTextContent("No data slots · 0 anomaly types · 1 to check");
    fireEvent.click(within(bar).getByRole("button", { name: "Checklist" }));
    const popover = screen.getByRole("dialog", { name: "Setup checklist" });
    expect(popover).toHaveTextContent("Give the project a name.");
    expect(within(bar).getByRole("button", { name: "Create project" })).toBeDisabled();
  });

  it("holds Create while a sort is running, with a warn line, and frees it when the sort ends", () => {
    store().setName("Site");
    store().setFolder("E:\\Projects\\Site");
    renderSummary();
    expect(create()).toBeEnabled();
    expect(checklist()).not.toHaveTextContent("Sorting files");
    act(() => store().beginInspect({ jobId: "j1", slotKey: null, paths: ["E:\\DCIM"] }));
    expect(create()).toBeDisabled();
    expect(within(checklist()).getByText("Sorting files… Create when it finishes")).toBeInTheDocument();
    act(() => store().clearInspect());
    expect(create()).toBeEnabled();
    expect(checklist()).not.toHaveTextContent("Sorting files");
  });

  it("names the whole folder a picked photo imports, without blocking Create", () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().setName("Mast");
    store().setFolder("E:\\Projects\\Mast");
    store().setBuckets(remap([draftBucket(VISUAL, { wholeFolder: true })], VERTICAL.config.slots));
    renderSummary();
    expect(within(checklist()).getByText("The whole folder 100MEDIA will be imported")).toBeInTheDocument();
    expect(create()).toBeEnabled();
  });
});
