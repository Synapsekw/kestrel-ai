import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { examplePhotoReview } from "@/test/assetFindingFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { OutcomeBar } from "./OutcomeBar";

const { api } = fakeClient([]);

describe("OutcomeBar", () => {
  it("links every outcome to the image browser filtered by it", () => {
    renderWithProviders(<OutcomeBar projectId={PROJECT_ID} counts={examplePhotoReview} />, { api });
    const expected: [string, string][] = [
      ["Finding: 12 photos", "finding"],
      ["Uncertain: 15 photos", "uncertain"],
      ["No finding: 90 photos", "none"],
      ["Not assessed: 3 photos", "not_assessed"],
    ];
    for (const [name, review] of expected)
      expect(screen.getByRole("link", { name })).toHaveAttribute(
        "href",
        `/p/${PROJECT_ID}/images?review=${review}`,
      );
  });

  it("sizes the bar's parts by their counts and leaves out empty ones", () => {
    renderWithProviders(
      <OutcomeBar projectId={PROJECT_ID} counts={{ ...examplePhotoReview, not_assessed: 0 }} />,
      { api },
    );
    const parts = screen.getAllByTestId("outcome-part");
    expect(parts.map((p) => p.style.flexGrow)).toEqual(["12", "15", "90"]);
  });

  it("draws nothing without reviewed photos", () => {
    const { container } = renderWithProviders(
      <OutcomeBar projectId={PROJECT_ID} counts={{ finding: 0, none: 0, uncertain: 0, not_assessed: 0 }} />,
      { api },
    );
    expect(container).toBeEmptyDOMElement();
  });
});
