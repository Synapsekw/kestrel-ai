import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { CloudViewer } from "./CloudViewer";

// jsdom has no WebGL: `canvas.getContext("webgl2")` answers null, as a machine whose graphics
// driver cannot start WebGL does, so three's renderer throws on construction.
describe("CloudViewer without WebGL", () => {
  it("says the 3D view cannot start instead of taking the screen down", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <CloudViewer
        cloud={exampleCloud}
        octreeUrl="http://127.0.0.1:1/octree/"
        token="t"
        budget={3_000_000}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The 3D view could not start");
    expect(alert).toHaveTextContent("WebGL");
    expect(screen.getByTestId("cloud-canvas")).toBeInTheDocument();
  });
});
