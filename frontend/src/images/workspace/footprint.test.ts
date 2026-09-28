import { expect, it } from "vitest";
import type { ImageDetail } from "@/api/images";
import { footprintInput } from "./footprint";

it("maps ImageDetail onto FB's FootprintInput", () => {
  const poly = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  };
  const d = {
    footprint: poly,
    footprint_kind: "trapezoid",
    camera: { gimbal_yaw: 12 },
  } as unknown as ImageDetail;
  expect(footprintInput(d)).toEqual({ kind: "trapezoid", geometry: poly, yawDeg: 12 });
  expect(footprintInput(null)).toBeNull();
});
