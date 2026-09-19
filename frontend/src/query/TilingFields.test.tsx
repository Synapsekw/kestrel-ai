import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { TilingFields } from "./TilingFields";

describe("TilingFields", () => {
  it("says what tiling is for", () => {
    render(<TilingFields form={{ ...DEFAULT_QUERY_FORM, tilingEnabled: true }} onChange={() => {}} />);
    expect(screen.getByTestId("tiling-note")).toHaveTextContent(
      "Each image is cut into overlapping tiles so that small machines stay visible",
    );
  });

  it("warns what a local model loses without tiling, and how that differs from pre-annotation", () => {
    render(
      <TilingFields
        form={{ ...DEFAULT_QUERY_FORM, kind: "local_model", tilingEnabled: false, tileSize: "1280" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("tiling-note")).toHaveTextContent(
      "Without tiling the whole image is scaled down to 1280 px before the model sees it, so small machines can disappear. (Pre-annotation in the editor uses 2560 px.)",
    );
  });
});
