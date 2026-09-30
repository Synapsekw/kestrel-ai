import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { CONFINED, MAPPING, SAVED, TEMPLATES, VERTICAL } from "@/test/setupFixtures";
import { useSetupDraft } from "./draftStore";
import { TemplateCard } from "./TemplateCard";
import { useTemplateChoice } from "./templateChoice";
import { useTemplates } from "./useTemplates";

function Harness() {
  const list = useTemplates();
  const choice = useTemplateChoice();
  return <TemplateCard list={list} choice={choice} />;
}

function renderCard(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient([
    ...extra,
    { method: "GET", path: /\/project-templates$/, body: { items: TEMPLATES } },
  ]);
  renderWithProviders(<Harness />, { api });
  return requests;
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });
const store = () => useSetupDraft.getState();

describe("TemplateCard", () => {
  beforeEach(() => store().discard());

  it("offers the built-ins, the saved templates and Blank, with Blank chosen on a fresh draft", async () => {
    renderCard();
    await screen.findByRole("radio", { name: /^Mapping and survey/ });
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      expect.stringContaining("Mapping and survey"),
      expect.stringContaining("Vertical asset inspection"),
      expect.stringContaining("Confined space inspection"),
      expect.stringContaining("Telecom mast, client X"),
      expect.stringContaining("Blank"),
    ]);
    expect(radio("Blank")).toBeChecked();
    expect(screen.getByRole("radiogroup", { name: "Template" })).toBeInTheDocument();
  });

  it("choosing a template fills the slots and the types", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: /^Vertical asset inspection/ }));
    expect(radio("Vertical asset inspection")).toBeChecked();
    expect(store().slots).toEqual(VERTICAL.config.slots);
    expect(store().types.map((t) => t.name)).toEqual(VERTICAL.config.types.map((t) => t.name));
  });

  it("asks replace-or-keep on every switch once the list was edited", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: /^Vertical asset inspection/ }));
    store().setType(store().types[0].key, { default_severity: 4 }); // an edit in the Anomalies card

    fireEvent.click(radio("Mapping and survey"));
    expect(screen.getByText("You changed the anomaly list")).toBeInTheDocument();
    expect(radio("Vertical asset inspection")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Keep mine and add the new ones" }));
    expect(radio("Mapping and survey")).toBeChecked();
    expect(store().types).toHaveLength(VERTICAL.config.types.length + MAPPING.config.types.length);

    fireEvent.click(radio("Confined space inspection"));
    expect(screen.getByText("You changed the anomaly list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Replace the anomaly list" }));
    expect(store().types.map((t) => t.name)).toEqual(CONFINED.config.types.map((t) => t.name));
    expect(store().typesEdited).toBe(false);

    fireEvent.click(radio("Vertical asset inspection"));
    expect(screen.queryByText("You changed the anomaly list")).toBeNull();
    expect(radio("Vertical asset inspection")).toBeChecked();
  });

  it("Cancel keeps the current template and list", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("radio", { name: /^Vertical asset inspection/ }));
    store().removeType(store().types[0].key);
    fireEvent.click(radio("Blank"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(radio("Vertical asset inspection")).toBeChecked();
    expect(store().types).toHaveLength(6);
  });

  it("built-ins have no menu", async () => {
    renderCard();
    await screen.findByRole("radio", { name: /^Vertical asset inspection/ });
    expect(screen.queryByRole("button", { name: "More for Vertical asset inspection" })).toBeNull();
  });

  it("renames a saved template from its menu and reloads the list", async () => {
    const requests = renderCard([
      { method: "PATCH", path: /\/project-templates\/tpl-saved-1$/, body: { ...SAVED, name: "Mast X" } },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "More for Telecom mast, client X" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const form = screen.getByRole("form", { name: "Rename Telecom mast, client X" });
    fireEvent.change(within(form).getByRole("textbox", { name: "New name for Telecom mast, client X" }), {
      target: { value: "Mast X" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ name: "Mast X" }));
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });

  it("says inline that a template name is taken", async () => {
    renderCard([
      {
        method: "PATCH",
        path: /\/project-templates\/tpl-saved-1$/,
        status: 409,
        body: errorBody("template_name_taken", "a template with that name exists"),
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "More for Telecom mast, client X" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const form = screen.getByRole("form", { name: "Rename Telecom mast, client X" });
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "Mapping and survey" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save name" }));
    expect(
      await within(form).findByText(
        "A template called Mapping and survey already exists. Choose another name.",
      ),
    ).toBeInTheDocument();
  });

  it("deletes a saved template after asking; the chosen one falls back to Blank and keeps the page", async () => {
    const requests = renderCard([
      { method: "DELETE", path: /\/project-templates\/tpl-saved-1$/, status: 204 },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: /^Telecom mast, client X/ }));
    fireEvent.click(screen.getByRole("button", { name: "More for Telecom mast, client X" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete the template Telecom mast, client X?" });
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(store().templateId).toBeNull());
    expect(requests.find((r) => r.method === "DELETE")?.url).toBe("/api/v1/project-templates/tpl-saved-1");
    expect(store().types).toHaveLength(3);
  });

  it("the catalogue is unavailable: only Blank, with the reason and Try again", async () => {
    const requests = renderCard([
      {
        method: "GET",
        path: /\/project-templates$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "catalogue.db could not be opened"),
      },
    ]);
    expect(
      await screen.findByText(
        "The catalogue is unavailable, so only Blank is offered. Types can be added later in Project settings. (catalogue.db could not be opened)",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(radio("Blank")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });
});
