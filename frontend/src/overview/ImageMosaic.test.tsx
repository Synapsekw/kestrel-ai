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
});

describe("ImageryPane", () => {
  it("shows up to eight thumbnails and the total", () => {
    renderWithProviders(<ImageryPane projectId={PROJECT_ID} images={images} total={1284} />, {
      api: fakeClient([]).api,
    });
    expect(screen.getAllByRole("img")).toHaveLength(8);
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", `/p/${PROJECT_ID}/images`);
  });
});
