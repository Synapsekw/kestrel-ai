import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ImageDetail } from "@/api/images";
import { exampleImage } from "@/test/fixtures";
import { InfoChip } from "./InfoChip";

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
};
const detail = {
  ...exampleImage,
  lat: 25.264123,
  lon: 55.292181,
  camera,
  footprint: null,
  footprint_kind: "point",
} as unknown as ImageDetail;

describe("InfoChip", () => {
  it("shows the file, capture, position, altitude and GSD", () => {
    render(<InfoChip detail={detail} onSetDistance={vi.fn()} />);
    const chip = screen.getByTestId("image-info-chip");
    expect(chip).toHaveTextContent(exampleImage.file_name);
    expect(chip).toHaveTextContent("25.26412, 55.29218");
    expect(chip).toHaveTextContent("Alt 38.4 m AGL");
    expect(chip).toHaveTextContent("GSD 1.8 mm/px");
  });
  it("shows GSD — and Set distance… without a distance", async () => {
    const onSetDistance = vi.fn();
    const none = {
      ...detail,
      camera: { ...camera, gsd_mm: null, distance_m: null, distance_source: "none" },
    } as unknown as ImageDetail;
    render(<InfoChip detail={none} onSetDistance={onSetDistance} />);
    expect(screen.getByTestId("image-info-chip")).toHaveTextContent("GSD —");
    await userEvent.click(screen.getByRole("button", { name: "Set distance…" }));
    expect(onSetDistance).toHaveBeenCalledOnce();
  });
});
