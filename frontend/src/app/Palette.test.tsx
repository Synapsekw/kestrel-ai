import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleClasses, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { useCommandRegistry, useCommands } from "./commands";
import { Palette } from "./Palette";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function ScreenWithCommand({ run }: { run: () => void }) {
  useCommands([{ id: "tool:box", title: "Box tool", run }]);
  return null;
}

function renderPalette(path: string, extra?: ReactNode) {
  const onClose = vi.fn();
  // signalSafe: the palette's search sources thread DS `CommandPalette`'s own `AbortController`
  // signal through `unwrap(api.GET(...))` once a query is typed — see FakeClientOptions.signalSafe.
  const { api } = fakeClient(
    [
      {
        method: "GET",
        path: /\/projects$/,
        body: {
          items: [exampleProject, { ...exampleProject, id: "p2", name: "North site" }],
          next_cursor: null,
        },
      },
      {
        method: "GET",
        path: /\/search$/,
        body: {
          findings: [{ id: "f1", number: 217, type_id: exampleClasses[0].id, note: "Crack" }],
          data: [],
        },
      },
    ],
    { signalSafe: true },
  );
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <Palette open onClose={onClose} project={exampleProject} />
            {extra}
            <Where />
          </>
        }
      />
    </Routes>,
    { api, route: path },
  );
  return onClose;
}

describe("Palette", () => {
  beforeEach(() => useCommandRegistry.setState({ entries: [] }));

  it("goes to a tab by name with the keyboard", async () => {
    const onClose = renderPalette(`/p/${PROJECT_ID}/images`);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "Findings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings`));
    expect(onClose).toHaveBeenCalled();
  });

  it("lists the other recent projects", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    expect(await screen.findByRole("option", { name: /North site/ })).toBeInTheDocument();
  });

  it("searches the project's findings from two characters", async () => {
    renderPalette(`/p/${PROJECT_ID}/images`);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cr" } });
    const hit = await screen.findByRole("option", { name: new RegExp(`F-0217 · ${exampleClasses[0].name}`) });
    fireEvent.click(hit);
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/findings/f1`),
    );
  });

  it("includes the commands a mounted screen registered", async () => {
    const run = vi.fn();
    renderPalette(`/p/${PROJECT_ID}/images`, <ScreenWithCommand run={run} />);
    fireEvent.click(await screen.findByRole("option", { name: /Box tool/ }));
    expect(run).toHaveBeenCalled();
  });

  it("skips recent projects that don't open (a missing folder or an unfinished upgrade)", async () => {
    const onClose = vi.fn();
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/projects$/,
        body: {
          items: [
            exampleProject,
            { ...exampleProject, id: "p2", name: "North site", availability: "missing" },
            {
              ...exampleProject,
              id: "p3",
              name: "Upgrading site",
              migration: { ...exampleProject.migration, state: "queued" },
            },
            { ...exampleProject, id: "p4", name: "Valid site" },
          ],
          next_cursor: null,
        },
      },
      { method: "GET", path: /\/search$/, body: { findings: [], data: [] } },
    ]);
    renderWithProviders(
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Palette open onClose={onClose} project={exampleProject} />
              <Where />
            </>
          }
        />
      </Routes>,
      { api, route: `/p/${PROJECT_ID}/images` },
    );
    // Confirms the async recent-projects fetch actually resolved and was applied, not just an
    // early assertion that would pass trivially while the request is still pending.
    expect(await screen.findByRole("option", { name: /Valid site/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /North site/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Upgrading site/ })).not.toBeInTheDocument();
  });
});
