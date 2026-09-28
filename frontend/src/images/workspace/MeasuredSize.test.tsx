import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImageCamera } from "@/api/images";
import { MeasuredSize } from "./MeasuredSize";

const camera = {
  rel_alt: 38.4,
  gimbal_pitch: -90,
  gimbal_yaw: 0,
  focal_mm: 12.3,
  focal_px: null,
  sensor_w_mm: 17.3,
  lrf_distance_m: null,
  subject_distance_m: null,
  distance_m: 38.4,
  distance_sigma_m: 1,
  distance_source: "rel_alt",
  gsd_mm: 1.8,
  camera_model: "M3E",
} as ImageCamera;
const box = { shape: "box" as const, w: 100, h: 50, points: null };

describe("MeasuredSize", () => {
  it("shows mm tiles with ± and the distance source", () => {
    render(<MeasuredSize shape={box} camera={camera} />);
    const el = screen.getByTestId("measured-size");
    expect(el).toHaveTextContent(/mm|m²/);
    expect(el).toHaveTextContent("±");
    expect(el).toHaveTextContent("nadir approx.");
  });
  it("shows px and offers Set distance without a trustworthy distance", async () => {
    const onSetDistance = vi.fn();
    render(
      <MeasuredSize
        shape={box}
        camera={{ ...camera, distance_source: "none", gsd_mm: null, distance_m: null }}
        onSetDistance={onSetDistance}
      />,
    );
    const el = screen.getByTestId("measured-size");
    expect(el).toHaveTextContent("px only");
    expect(el).not.toHaveTextContent(/\bmm\b/);
    await userEvent.click(screen.getByRole("button", { name: "Set distance…" }));
    expect(onSetDistance).toHaveBeenCalledOnce();
  });
  it("a point is a marker, not a size", () => {
    render(<MeasuredSize shape={{ shape: "point", w: 0, h: 0, points: null }} camera={camera} />);
    expect(screen.getByTestId("measured-size")).toHaveTextContent("Point marker");
  });
});
