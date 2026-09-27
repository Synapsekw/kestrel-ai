import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleSeverity } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useSeverityScale } from "@/ui";
import { CatalogueSeverityProvider } from "./CatalogueSeverityProvider";
import { SeverityEditor } from "./SeverityEditor";
import { useCatalogueSeverity } from "./severityStore";

const GET: FakeRoute = { method: "GET", path: /\/catalogue\/severity$/, body: { levels: exampleSeverity } };

function Probe() {
  return (
    <span data-testid="scale">
      {useSeverityScale()
        .map((l) => l.name)
        .join(",")}
    </span>
  );
}

function renderEditor(routes: FakeRoute[]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <CatalogueSeverityProvider>
      <SeverityEditor />
      <Probe />
    </CatalogueSeverityProvider>,
    { api },
  );
  return requests;
}

describe("SeverityEditor", () => {
  // The loaded scale is module state: every case starts from "not loaded yet".
  beforeEach(() => useCatalogueSeverity.setState({ levels: null }));

  it("renames a level, saves the whole scale and updates every pill in the app", async () => {
    const requests = renderEditor([
      GET,
      { method: "PUT", path: /\/catalogue\/severity$/, body: (r) => r.body as object },
    ]);
    fireEvent.change(await screen.findByLabelText("Name of level 2"), { target: { value: "Medium" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(await screen.findByText("Severity scale saved")).toBeInTheDocument();
    expect(
      (requests.find((r) => r.method === "PUT")?.body as { levels: { name: string }[] }).levels[1].name,
    ).toBe("Medium");
    await waitFor(() => expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Medium,Major,Critical"));
  });

  it("adds levels up to nine and removes only the top one", async () => {
    renderEditor([GET]);
    await screen.findByLabelText("Name of level 4");
    fireEvent.click(screen.getByRole("button", { name: "Add level" }));
    expect(screen.getByLabelText("Name of level 5")).toHaveValue("Level 5");
    fireEvent.click(screen.getByRole("button", { name: "Remove top level" }));
    expect(screen.queryByLabelText("Name of level 5")).not.toBeInTheDocument();
    for (let i = 0; i < 5; i += 1) fireEvent.click(screen.getByRole("button", { name: "Add level" }));
    expect(screen.getByLabelText("Name of level 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add level" })).toBeDisabled();
  });

  it("refuses a duplicate name before sending", async () => {
    const requests = renderEditor([GET]);
    fireEvent.change(await screen.findByLabelText("Name of level 2"), { target: { value: "minor" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(
      screen.getByText('Two levels are called "minor". Give each level its own name.'),
    ).toBeInTheDocument();
    expect(requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("names the projects when the top level is still in use, and keeps the drafts", async () => {
    renderEditor([
      GET,
      {
        method: "PUT",
        path: /\/catalogue\/severity$/,
        status: 409,
        body: errorBody("severity_in_use", "in use", { level: 4, projects: ["Ahmadia"] }),
      },
    ]);
    await screen.findByLabelText("Name of level 4");
    fireEvent.click(screen.getByRole("button", { name: "Remove top level" }));
    fireEvent.click(screen.getByRole("button", { name: "Save scale" }));
    expect(
      await screen.findByText(
        "Level 4 (Critical) is still used by open findings in Ahmadia. Regrade or close them, then remove the level.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name of level 4")).not.toBeInTheDocument();
    expect(screen.getByTestId("scale")).toHaveTextContent("Minor,Moderate,Major,Critical");
  });

  it("previews the drafts live", async () => {
    renderEditor([GET]);
    fireEvent.change(await screen.findByLabelText("Name of level 4"), { target: { value: "Urgent" } });
    const preview = screen.getByRole("region", { name: "Severity preview" });
    await waitFor(() => expect(preview).toHaveTextContent("Urgent"));
  });
});
