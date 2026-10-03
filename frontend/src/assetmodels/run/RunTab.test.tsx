import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL, RUN, RUN_FINISHED } from "@/test/assetModelFixtures";
import { RunTab } from "./RunTab";

describe("RunTab", () => {
  it("shows the summary, open questions and steps", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <RunTab projectId={PROJECT_ID} model={MODEL} runs={[RUN_FINISHED]} onStarted={() => {}} />,
      { api },
    );
    expect(screen.getByText(RUN_FINISHED.summary!)).toBeInTheDocument();
    expect(screen.getByText(/roof type\?/i)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem", { name: /step/i })).toHaveLength(RUN_FINISHED.steps.length);
    expect(screen.getByText(/k tokens|m tokens/i)).toBeInTheDocument();
  });

  it("refine-with-note opens the dialog with the question prefilled", async () => {
    const { api } = fakeClient([{ method: "GET", path: /\/providers$/, body: { items: [] } }]);
    renderWithProviders(
      <RunTab projectId={PROJECT_ID} model={MODEL} runs={[RUN_FINISHED]} onStarted={() => {}} />,
      { api },
    );
    fireEvent.click(screen.getByRole("button", { name: /refine with this note/i }));
    expect(await screen.findByLabelText(/notes/i)).toHaveValue("Roof type?");
  });

  it("lists older runs under Earlier runs and shows one when picked", () => {
    const { api } = fakeClient([]);
    renderWithProviders(
      <RunTab projectId={PROJECT_ID} model={MODEL} runs={[RUN, RUN_FINISHED]} onStarted={() => {}} />,
      { api },
    );
    expect(screen.getByText(RUN.summary!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /earlier runs/i }));
    const earlier = screen.getByRole("list", { name: /earlier runs/i });
    fireEvent.click(within(earlier).getByRole("button", { name: /build/i }));
    expect(screen.getByText(RUN_FINISHED.summary!)).toBeInTheDocument();
  });

  it("says so when the model has no runs", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<RunTab projectId={PROJECT_ID} model={MODEL} runs={[]} onStarted={() => {}} />, {
      api,
    });
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });

  it("a finished plant run links to the site view; an asset run does not", () => {
    const { api } = fakeClient([]);
    const { unmount } = renderWithProviders(
      <RunTab
        projectId={PROJECT_ID}
        model={{ ...MODEL, kind: "plant" }}
        runs={[RUN_FINISHED]}
        onStarted={() => {}}
      />,
      { api },
    );
    expect(screen.getByRole("link", { name: "Open in site" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/site/${MODEL.id}`,
    );
    unmount();
    renderWithProviders(
      <RunTab
        projectId={PROJECT_ID}
        model={{ ...MODEL, kind: "asset" }}
        runs={[RUN_FINISHED]}
        onStarted={() => {}}
      />,
      { api },
    );
    expect(screen.queryByRole("link", { name: "Open in site" })).toBeNull();
  });
});
