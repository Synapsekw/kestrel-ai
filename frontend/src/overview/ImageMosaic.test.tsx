import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID, exampleImage } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImageMosaic } from "./ImageMosaic";
import { ImageryPane } from "./ImageryPane";

const images = Array.from({ length: 8 }, (_, i) => ({ ...exampleImage, id: `img-${i}` }));

describe("ImageMosaic", () => {
  it("shows the five newest frames, each opening the image", () => {
    renderWithProviders(<ImageMosaic projectId={PROJECT_ID} images={images} />, { api: fakeClient([]).api });
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAccessibleName(`Open photo ${exampleImage.file_name}`);
    expect(links[0]).toHaveAttribute("href", `/p/${PROJECT_ID}/images/img-0`);
  });

  // cols × rows, and how many rows the first frame spans: every cell is filled, none left blank.
  it.each([
    [1, 1, 1, 1],
    [2, 2, 1, 1],
    [3, 2, 2, 2],
    [4, 2, 3, 3],
    [5, 3, 2, 2],
  ])("with %i image(s) the grid has no blank cells", (n, cols, rows, span) => {
    renderWithProviders(<ImageMosaic projectId={PROJECT_ID} images={images.slice(0, n)} />, {
      api: fakeClient([]).api,
    });
    const grid = screen.getByTestId("mosaic-grid");
    expect(grid.dataset.cols).toBe(String(cols));
    expect(grid.dataset.rows).toBe(String(rows));
    expect(screen.getAllByRole("link")[0].dataset.span).toBe(String(span));
    expect(cols * rows).toBe(n + span - 1);
  });
});

describe("ImageryPane", () => {
  it("shows up to eight thumbnails and the total", () => {
    renderWithProviders(<ImageryPane projectId={PROJECT_ID} images={images} total={1284} />, {
      api: fakeClient([]).api,
    });
    // Decorative: the pane is labelled, and a broken thumbnail must not print its path over the tile.
    const thumbs = document.querySelectorAll("img");
    expect(thumbs).toHaveLength(8);
    thumbs.forEach((t) => expect(t).toHaveAttribute("alt", ""));
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", `/p/${PROJECT_ID}/images`);
  });
});
