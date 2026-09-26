import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ReportsPlaceholder } from "@/reports/ReportsPlaceholder";
import { useAddData } from "./addDataStore";
import { InterimFindings, InterimOverview, SectionPlaceholder } from "./InterimScreens";
import { NotFound } from "./NotFound";

describe("interim screens", () => {
  beforeEach(() => useAddData.setState({ open: false, tile: null }));

  it("Overview says what to add first and opens Add data", () => {
    const { api } = fakeClient([]);
    renderWithProviders(<InterimOverview />, {
      api,
      route: `/p/${PROJECT_ID}/overview`,
      path: "/p/:projectId/overview",
    });
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add data" }));
    expect(useAddData.getState().open).toBe(true);
  });

  it("Findings says where findings come from", () => {
    render(<InterimFindings />);
    expect(screen.getByText(/created in the Images, Maps and Point clouds workspaces/)).toBeInTheDocument();
  });

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
