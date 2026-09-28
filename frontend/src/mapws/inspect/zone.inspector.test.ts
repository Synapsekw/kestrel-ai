import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteArea } from "@/api/siteAreas";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { toast } from "@/ui";
import { useZonesStore } from "@/mapws/zones/store";
import zone from "./zone.inspector";

vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui")>()),
  toast: vi.fn(),
}));

const ZONE = "5a000000-aaaa-4000-8000-000000000001";
const sel = { kind: "zone" as const, id: ZONE };
const area = { id: ZONE, name: "North laydown", category: "laydown" } as unknown as SiteArea;

describe("the zone inspector's Del (W3-14, M-W3 P9/A17)", () => {
  beforeEach(() => {
    useZonesStore.setState({ items: [area], revision: 0 });
    vi.mocked(toast).mockClear();
  });

  it("confirms with the recount line only; W1's title already asks the question", () => {
    expect(zone.remove!.confirm(sel)).toBe("Object counts update in the background.");
  });

  it("deletes, drops the zone from the layer and says the counts follow", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/site-areas\/[^/]+$/, status: 204 }]);
    await zone.remove!.run(sel, { api, projectId: PROJECT_ID });
    expect(requests.map((r) => r.method)).toEqual(["DELETE"]);
    expect(useZonesStore.getState().items).toEqual([]);
    expect(toast).toHaveBeenCalledWith("ok", "North laydown deleted — counts update in the background");
  });
});
