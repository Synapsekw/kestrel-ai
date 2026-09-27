import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SEP, surfaceLayer } from "../test/rasterFixtures";
import { ElevationStyle } from "./ElevationStyle";
import { elevationRows } from "./rasterRows";

const [row] = elevationRows({ layers: [surfaceLayer("dsm", SEP)] });

describe("ElevationStyle (deviation 3)", () => {
  it("switches the render mode", async () => {
    const setStyle = vi.fn();
    render(<ElevationStyle row={row} style={{}} setStyle={setStyle} />);
    expect(screen.getByRole("radio", { name: "Hillshade" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Contours" }));
    expect(setStyle).toHaveBeenCalledWith({ render: "contours" });
  });

  it("commits a positive contour interval on Enter or blur, clears it when empty, refuses junk", async () => {
    const setStyle = vi.fn();
    render(<ElevationStyle row={row} style={{ render: "contours" }} setStyle={setStyle} />);
    const input = screen.getByLabelText("Contour interval of dsm (m)");
    await userEvent.type(input, "0.5{Enter}");
    expect(setStyle).toHaveBeenLastCalledWith({ interval: 0.5 });
    await userEvent.clear(input);
    fireEvent.blur(input);
    expect(setStyle).toHaveBeenLastCalledWith({ interval: null });
    await userEvent.type(input, "-3");
    fireEvent.blur(input);
    expect(setStyle).toHaveBeenCalledTimes(2);
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("hides the interval unless the mode is contours", () => {
    render(<ElevationStyle row={row} style={{ render: "tint" }} setStyle={vi.fn()} />);
    expect(screen.queryByLabelText(/Contour interval/)).toBeNull();
  });
});
