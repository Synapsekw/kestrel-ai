import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { VERTICAL, setupRoutes, typeSpec } from "@/test/setupFixtures";
import { AnomaliesCard } from "./AnomaliesCard";
import { useSetupDraft } from "./draftStore";

function renderCard(routes: FakeRoute[] = setupRoutes()) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<AnomaliesCard />, { api });
  return requests;
}

const row = (name: string) => screen.getByRole("listitem", { name });
const ensures = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.url.endsWith("/catalogue/types/ensure"));
const dryRuns = (requests: RecordedRequest[]) =>
  ensures(requests).filter((r) => (r.body as { dry_run?: boolean }).dry_run === true);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function addFromCatalogue(name: string) {
  const add = screen.getByRole("button", { name: "Add from Catalogue" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  fireEvent.click(
    within(screen.getByRole("listbox", { name: "Catalogue types" })).getByRole("option", {
      name: new RegExp(name),
    }),
  );
}

describe("AnomaliesCard", () => {
  beforeEach(() => useSetupDraft.getState().discard());

  it("shows the template's types with colour, kind, severity and hotkey, and edits them", () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    renderCard();
    expect(within(screen.getByRole("list", { name: "Anomaly types" })).getAllByRole("listitem")).toHaveLength(
      7,
    );
    expect(screen.getByRole("combobox", { name: "Hotkey of Corrosion" })).toHaveValue("1");
    expect(screen.getByRole("combobox", { name: "Severity of Corrosion" })).toHaveValue("2");
    expect(screen.getByRole("combobox", { name: "Kind of Bird nest" })).toHaveValue("object");
    expect(screen.getByLabelText("Colour of Bird nest")).toHaveValue("#22c55e");
    fireEvent.change(screen.getByRole("combobox", { name: "Severity of Corrosion" }), {
      target: { value: "4" },
    });
    expect(useSetupDraft.getState().types[0].default_severity).toBe(4);
    expect(useSetupDraft.getState().typesEdited).toBe(true);
  });

  it("adds a catalogue type; the catalogue is one bounded page and archived types are not offered", async () => {
    const requests = renderCard();
    const add = screen.getByRole("button", { name: "Add from Catalogue" });
    await waitFor(() => expect(add).toBeEnabled());
    expect(requests.find((r) => r.url.startsWith("/api/v1/catalogue/types?"))?.url).toContain("limit=1000");
    fireEvent.click(add);
    const picker = screen.getByRole("listbox", { name: "Catalogue types" });
    expect(within(picker).queryByRole("option", { name: /Old type/ })).toBeNull();
    fireEvent.click(within(picker).getByRole("option", { name: /Scaffold/ }));
    expect(row("Scaffold")).toBeInTheDocument();
    expect(useSetupDraft.getState().types.at(-1)).toMatchObject({
      name: "Scaffold",
      kind: "object",
      hotkey: "3",
    });
  });

  it("does not offer a catalogue type that is already listed", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    renderCard();
    const add = screen.getByRole("button", { name: "Add from Catalogue" });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    const picker = screen.getByRole("listbox", { name: "Catalogue types" });
    expect(within(picker).queryByRole("option", { name: /Corrosion/ })).toBeNull();
    expect(within(picker).getByRole("option", { name: /Scaffold/ })).toBeInTheDocument();
  });

  it("flags a hotkey clash between a template type and an added catalogue type", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    renderCard();
    await addFromCatalogue("Scaffold");
    expect(
      within(row("Scaffold")).getByText("Hotkey 3 is also used by Loose / missing bolt."),
    ).toBeInTheDocument();
    expect(
      within(row("Loose / missing bolt")).getByText("Hotkey 3 is also used by Scaffold."),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Hotkey of Scaffold" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Hotkey of Scaffold" }), {
      target: { value: "8" },
    });
    expect(screen.queryByText(/is also used by/)).toBeNull();
  });

  it("shows a Catalogue conflict from one debounced dry run per settled list", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    const requests = renderCard();
    expect(
      await within(row("Bird nest")).findByText(
        "Already in your Catalogue as Defect. The Catalogue's kind and colour are kept.",
        {},
        { timeout: 2000 },
      ),
    ).toBeInTheDocument();
    expect(dryRuns(requests)).toHaveLength(1);
    expect((dryRuns(requests)[0].body as { types: unknown[] }).types).toHaveLength(7);

    const severity = screen.getByRole("combobox", { name: "Severity of Corrosion" });
    fireEvent.change(severity, { target: { value: "3" } });
    fireEvent.change(severity, { target: { value: "4" } });
    await waitFor(() => expect(dryRuns(requests)).toHaveLength(2));
    await wait(400);
    expect(dryRuns(requests)).toHaveLength(2);
    expect(ensures(requests)).toHaveLength(2); // nothing but dry runs before Create
  });

  it("adds a new type inline and refuses a name already in the list", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "New type" }));
    const form = screen.getByRole("form", { name: "New type" });
    fireEvent.change(within(form).getByLabelText("Type name"), { target: { value: "Rust streak" } });
    fireEvent.click(within(form).getByRole("radio", { name: "Object" }));
    fireEvent.change(within(form).getByLabelText("Default severity"), { target: { value: "2" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add type" }));
    expect(screen.queryByRole("form", { name: "New type" })).toBeNull();
    expect(useSetupDraft.getState().types[0]).toMatchObject({
      name: "Rust streak",
      kind: "object",
      default_severity: 2,
      hotkey: "1",
      colour: "#f97316",
    });

    fireEvent.click(screen.getByRole("button", { name: "New type" }));
    fireEvent.change(screen.getByLabelText("Type name"), { target: { value: "rust_streak" } });
    fireEvent.click(screen.getByRole("button", { name: "Add type" }));
    expect(screen.getByText("rust_streak is already in the list.")).toBeInTheDocument();
    expect(useSetupDraft.getState().types).toHaveLength(1);
  });

  it("a row expands to edit its definition and shows its rules", () => {
    useSetupDraft.getState().addType({
      ...typeSpec("Corrosion", "defect", 2, "1"),
      severity_rules: [{ when: "section loss visible", severity: 3 }],
    });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Details of Corrosion" }));
    fireEvent.change(screen.getByLabelText("Definition"), { target: { value: "Flaking on steel." } });
    expect(useSetupDraft.getState().types[0].definition).toBe("Flaking on steel.");
    expect(screen.getByLabelText("Rule 1 condition")).toHaveValue("section loss visible");
    expect(screen.getByLabelText("Rule 1 severity")).toHaveDisplayValue("3 Major");
    expect(screen.queryByText(/edited on the type in the Catalogue/)).toBeNull();
  });

  it("edits severity rules in place; the draft keeps plain rules with no key", () => {
    useSetupDraft.getState().addType(typeSpec("Corrosion", "defect", 2, "1"));
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Details of Corrosion" }));
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(
      screen.getByText("Rule 1 needs a condition. Say when it applies, or remove it."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Rule 1 condition"), { target: { value: " wider than 5 mm " } });
    fireEvent.change(screen.getByLabelText("Rule 1 severity"), { target: { value: "4" } });
    expect(useSetupDraft.getState().types[0].severity_rules).toEqual([
      { when: "wider than 5 mm", severity: 4 },
    ]);
    expect(screen.queryByText(/needs a condition/)).toBeNull();
  });

  it("removing a type marks the list edited", () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Remove Bird nest" }));
    expect(screen.queryByRole("listitem", { name: "Bird nest" })).toBeNull();
    expect(useSetupDraft.getState().typesEdited).toBe(true);
  });

  it("catalogue unavailable: Add from Catalogue is off, with today's message, and no dry run is sent", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    const requests = renderCard([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "catalogue.db could not be opened"),
      },
    ]);
    expect(
      await screen.findByText(
        "The catalogue is unavailable, so types can be added later in Project settings. (catalogue.db could not be opened)",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add from Catalogue" })).toBeDisabled();
    // A new type is created through the Catalogue, so Create would fail with it; it waits for Project settings.
    expect(screen.getByRole("button", { name: "New type" })).toBeDisabled();
    await wait(400);
    expect(ensures(requests)).toHaveLength(0);
  });
});
