import { describe, expect, it } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Rail } from "./Rail";

function renderRail(path: string, projectId?: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Rail projectId={projectId} />
    </MemoryRouter>,
  );
  return screen.getByRole("navigation", { name: "Main navigation" });
}

describe("Rail", () => {
  it("lists Projects, Models, Catalogue, Jobs and Settings, with the logo first", () => {
    const nav = renderRail("/projects");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Kestrel AI",
      "Projects",
      "Models",
      "Catalogue",
      "Jobs",
      "Settings",
    ]);
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("href", "/models");
    expect(within(nav).getByRole("link", { name: "Catalogue" })).toHaveAttribute("href", "/catalogue");
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("marks Projects inside a project and sends Jobs to that project's jobs", () => {
    const nav = renderRail("/p/p1/images", "p1");
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Models" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs?project=p1");
  });

  it("marks the section of an app page and links Jobs plainly outside a project", () => {
    const nav = renderRail("/models/datasets");
    expect(within(nav).getByRole("link", { name: "Models" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
  });

  it("marks Settings on About", () => {
    const nav = renderRail("/about");
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  it("names an entry in a tooltip on focus", () => {
    const nav = renderRail("/projects");
    act(() => within(nav).getByRole("link", { name: "Catalogue" }).focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent("Catalogue");
  });
});
