import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { SummaryHero } from "./SummaryHero";

const data = { image_sets: 0, images: 0, maps: 0, elevations: 1, point_clouds: 0, drawings: 2 };

describe("SummaryHero", () => {
  it("shows the drawing when the hero is a drawing", () => {
    renderWithProviders(
      <SummaryHero projectId={PROJECT_ID} hero={{ kind: "drawing", id: "d1" }} data={data} />,
      { api: fakeClient([]).api },
    );
    expect(screen.getByRole("img", { name: /drawing/i })).toHaveAttribute(
      "src",
      expect.stringContaining("/drawings/d1/thumbnail"),
    );
  });

  it("otherwise lists only the data kinds present", () => {
    renderWithProviders(<SummaryHero projectId={PROJECT_ID} hero={null} data={data} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getByRole("link", { name: /1 elevation/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2 drawings/i })).toBeInTheDocument();
    expect(screen.queryByText(/map/i)).not.toBeInTheDocument();
  });
});
