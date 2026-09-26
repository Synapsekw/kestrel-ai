import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { exampleOverview, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectTabs } from "./ProjectTabs";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderTabs(path: string, overviewStatus = 200) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/overview$/,
      status: overviewStatus,
      body: overviewStatus === 200 ? exampleOverview : { error: { code: "x", message: "down" } },
    },
  ]);
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <ProjectTabs projectId={PROJECT_ID} />
            <Where />
          </>
        }
      />
    </Routes>,
    { api, route: path },
  );
  return { requests };
}

describe("ProjectTabs", () => {
  it("lists the seven tabs as links, marks the current one and shows the counts", async () => {
    renderTabs(`/p/${PROJECT_ID}/findings`);
    const list = screen.getByRole("tablist");
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toHaveLength(7);
    expect(within(list).getByRole("tab", { name: /^Images/ })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images`,
    );
    expect(within(list).getByRole("tab", { name: /^Findings/ })).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(within(list).getByRole("tab", { name: /^Images/ })).toHaveTextContent(/1,?284/),
    );
    expect(within(list).getByRole("tab", { name: /^Maps/ })).toHaveTextContent("3");
    expect(within(list).getByRole("tab", { name: /^Point clouds/ })).toHaveTextContent("2");
    expect(within(list).getByRole("tab", { name: /^Findings/ })).toHaveTextContent("47");
  });

  it("selects the Images tab inside the image workspace", () => {
    renderTabs(`/p/${PROJECT_ID}/images/i1`);
    expect(screen.getByRole("tab", { name: /^Images/ })).toHaveAttribute("aria-selected", "true");
  });

  it("still works without counts when the overview fails", async () => {
    const { requests } = renderTabs(`/p/${PROJECT_ID}/overview`, 503);
    // Waits on the recorded request settling, then retries the assertion until the failed
    // overview has actually been handled, rather than a fixed sleep that would race a regression.
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => {
      expect(screen.getAllByRole("tab")).toHaveLength(7);
      expect(screen.getByRole("tab", { name: /^Images/ })).not.toHaveTextContent(/\d/);
    });
  });

  it("reaches the secondary pages from More", async () => {
    renderTabs(`/p/${PROJECT_ID}/overview`);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Runs", "Review", "Detect", "Analytics", "Site areas", "Export", "Project settings"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Analytics" }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/p/${PROJECT_ID}/analytics`);
  });
});
