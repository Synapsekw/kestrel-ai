import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { SidebarView } from "./SidebarView";

function renderView(props: Partial<Parameters<typeof SidebarView>[0]> = {}) {
  const onToggle = vi.fn();
  render(
    <MemoryRouter>
      <SidebarView section="models" collapsed={false} activeJobs={0} onToggle={onToggle} {...props} />
    </MemoryRouter>,
  );
  return { onToggle, nav: screen.getByRole("navigation", { name: "Main navigation" }) };
}

describe("SidebarView", () => {
  it("lists the brand, the sections and Settings, and marks the current section", () => {
    const { nav } = renderView();
    expect(
      within(nav)
        .getAllByRole("link")
        .map((l) => l.getAttribute("aria-label")),
    ).toEqual(["Kestrel AI", "Projects", "Models", "Catalogue", "Jobs", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
    expect(nav).toHaveAttribute("data-state", "expanded");
  });

  it("inside a project: Projects is a parent, not current, and Jobs keeps the project", () => {
    const { nav } = renderView({ section: "projects", projectId: "p1", tree: <p>tree</p> });
    expect(within(nav).getByRole("link", { name: "Projects" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs?project=p1");
    expect(within(nav).getByText("tree")).toBeInTheDocument();
  });

  it("badges Jobs with the active count without renaming it, and hides the badge at 0", () => {
    const { nav } = renderView({ activeJobs: 2 });
    const jobs = within(nav).getByRole("link", { name: "Jobs" });
    expect(jobs).toHaveTextContent("2");
  });

  it("collapses: names stay, tooltips show, the button says Expand sidebar", () => {
    const { nav, onToggle } = renderView({ collapsed: true });
    expect(nav).toHaveAttribute("data-state", "collapsed");
    const catalogue = within(nav).getByRole("link", { name: "Catalogue" });
    act(() => catalogue.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Catalogue");
    const expand = within(nav).getByRole("button", { name: "Expand sidebar" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(onToggle).toHaveBeenCalled();
  });

  it("offers Collapse sidebar with its Ctrl+B key caps when expanded", () => {
    const { nav } = renderView();
    const button = within(nav).getByRole("button", { name: "Collapse sidebar" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+B");
  });

  it("keeps keyboard focus on the toggle when the sidebar collapses and expands", () => {
    function Harness() {
      const [collapsed, setCollapsed] = useState(false);
      return (
        <SidebarView
          section="models"
          collapsed={collapsed}
          activeJobs={0}
          onToggle={() => setCollapsed((c) => !c)}
        />
      );
    }
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps a link's focus across a collapse", () => {
    const { rerender } = render(
      <MemoryRouter>
        <SidebarView section="models" collapsed={false} activeJobs={0} onToggle={() => {}} />
      </MemoryRouter>,
    );
    const jobs = screen.getByRole("link", { name: "Jobs" });
    jobs.focus();
    rerender(
      <MemoryRouter>
        <SidebarView section="models" collapsed activeJobs={0} onToggle={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Jobs" })).toBe(jobs);
    expect(document.activeElement).toBe(jobs);
  });
});
