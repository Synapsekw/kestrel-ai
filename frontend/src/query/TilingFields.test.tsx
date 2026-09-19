import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_QUERY_FORM } from "./queryModel";
import { TilingFields } from "./TilingFields";

describe("TilingFields", () => {
  it("says what tiling is for", () => {
    render(<TilingFields form={{ ...DEFAULT_QUERY_FORM, tilingEnabled: true }} onChange={() => {}} />);
    // The tiling settings fold away while they hold the defaults.
    expect(screen.queryByTestId("tiling-note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Tiling/ }));
    expect(screen.getByTestId("tiling-note")).toHaveTextContent(
      "Each image is cut into overlapping tiles so that small machines stay visible",
    );
  });

  it("stays in sight: the confidence field is not folded away", () => {
    render(<TilingFields form={DEFAULT_QUERY_FORM} onChange={() => {}} />);
    expect(screen.getByLabelText("Confidence")).toHaveValue(Number(DEFAULT_QUERY_FORM.conf));
    expect(screen.queryByLabelText("Tile large images")).not.toBeInTheDocument();
  });

  it("opens by itself when tiling differs from the defaults, and warns what a local model loses without tiling, and how that differs from pre-annotation", () => {
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
