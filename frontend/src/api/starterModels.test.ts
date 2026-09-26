import { describe, it, expect } from "vitest";
import type { StarterModel } from "@contract/client";
import { fakeClient } from "@/test/fixtures";
import { listStarterModels } from "./starterModels";

const starters: StarterModel[] = [
  { key: "yolo11n", name: "YOLO11 nano", description: "Fastest.", size_mb: 5.4, available: true },
  { key: "yolo11m", name: "YOLO11 medium", description: "Slowest.", size_mb: 0, available: false },
];

describe("starter models api", () => {
  it("lists the catalogue", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/starter-models$/, body: { items: starters, next_cursor: null } },
    ]);
    expect(await listStarterModels(api)).toEqual(starters);
    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/v1/starter-models" });
  });
});
