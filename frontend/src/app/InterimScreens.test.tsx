import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReportsPlaceholder } from "@/reports/ReportsPlaceholder";
import { SectionPlaceholder } from "./InterimScreens";
import { NotFound } from "./NotFound";

describe("interim screens", () => {
  it("an app section placeholder has its title as the page heading", () => {
    render(
      <SectionPlaceholder title="Catalogue" icon="catalogue">
        Types
      </SectionPlaceholder>,
    );
    expect(screen.getByRole("heading", { name: "Catalogue" })).toBeInTheDocument();
  });

  it("Reports is an empty state", () => {
    render(<ReportsPlaceholder />);
    expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
  });

  it("an unknown address offers the way back to Projects", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nothing at this address")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Projects" })).toHaveAttribute("href", "/projects");
  });
});
