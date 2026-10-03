import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { projectInitials, SidebarProjectTree } from "./SidebarProjectTree";
import type { ProjectCounts } from "./useProjectCounts";

const COUNTS: ProjectCounts = { images: 1284, maps: 3, drawings: 0, pointClouds: 2, openFindings: 47 };

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

function renderTree(props: Partial<Parameters<typeof SidebarProjectTree>[0]> = {}) {
  render(
    <MemoryRouter initialEntries={["/p/p1/findings"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SidebarProjectTree
                projectId="p1"
                projectName="Al Khail Gate Phase 2"
                busy={false}
                counts={COUNTS}
                tab="findings"
                secondary={null}
                collapsed={false}
                {...props}
              />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  const name = props.projectName === null ? "Project" : (props.projectName ?? "Al Khail Gate Phase 2");
  return screen.getByRole("group", { name });
}

describe("SidebarProjectTree", () => {
  it("lists the nine pages with counts in their names and marks the current one", () => {
    const tree = renderTree();
    const names = within(tree)
      .getAllByRole("link")
      .map((l) => l.getAttribute("aria-label"));
    expect(names).toEqual([
      "Al Khail Gate Phase 2",
      "Overview",
      "Images 1,284",
      "Maps 3",
      "Drawings 0",
      "Point clouds 2",
      "Asset models",
      "Findings 47",
      "Measurements",
      "Reports",
    ]);
    expect(within(tree).getByRole("link", { name: "Findings 47" })).toHaveAttribute("aria-current", "page");
    expect(within(tree).getByRole("link", { name: "Images 1,284" })).toHaveAttribute("href", "/p/p1/images");
    expect(within(tree).getByRole("link", { name: "Al Khail Gate Phase 2" })).toHaveAttribute(
      "href",
      "/p/p1/overview",
    );
    expect(within(tree).getByRole("link", { name: "Al Khail Gate Phase 2" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("names pages without counts while the counts are unavailable", () => {
    const tree = renderTree({ counts: null });
    expect(within(tree).getByRole("link", { name: "Images" })).toBeInTheDocument();
  });

  it("calls an unloaded project 'Project' and shows its live dot while a job runs", () => {
    const tree = renderTree({ projectName: null, busy: true });
    expect(within(tree).getByRole("link", { name: "Project" })).toBeInTheDocument();
    expect(within(tree).getByLabelText("Jobs running")).toBeInTheDocument();
  });

  it("opens More to reveal the secondary pages", () => {
    const tree = renderTree();
    expect(within(tree).queryByRole("link", { name: "Runs" })).toBeNull();
    const more = within(tree).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByRole("link", { name: "Review" })).toHaveAttribute(
      "href",
      "/p/p1/review?view=runs",
    );
    expect(within(tree).getByRole("link", { name: "Project settings" })).toHaveAttribute(
      "href",
      "/p/p1/settings",
    );
  });

  it("keeps More open on a secondary page and marks it", () => {
    const tree = renderTree({ tab: null, secondary: "runs" });
    expect(within(tree).getByRole("button", { name: "More" })).toHaveAttribute("aria-expanded", "true");
    expect(within(tree).getByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page");
  });

  it("collapsed: keeps link names, shows a tooltip, and turns More into a menu", async () => {
    const tree = renderTree({ collapsed: true });
    const findings = within(tree).getByRole("link", { name: "Findings 47" });
    act(() => findings.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Findings");
    fireEvent.click(within(tree).getByRole("button", { name: "More pages" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Analytics" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/p/p1/analytics");
  });

  it("makes initials from the first two words", () => {
    expect(projectInitials("Al Khail Gate Phase 2")).toBe("AK");
    expect(projectInitials("tank")).toBe("T");
    expect(projectInitials("  ")).toBe("P");
  });
});
