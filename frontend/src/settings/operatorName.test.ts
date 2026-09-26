import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { fetchOperatorName, saveOperatorName } from "./operatorName";

describe("operator name (F §5.3, used on comments; stored by the backend)", () => {
  it("reads the name from GET /settings/operator", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/settings\/operator$/, body: { operator_name: "Dana" } },
    ]);
    expect(await fetchOperatorName(api)).toBe("Dana");
  });

  it("saves a trimmed name, and a blank one as null, with PUT", async () => {
    const { api, requests } = fakeClient([
      { method: "PUT", path: /\/settings\/operator$/, body: (r) => r.body as object },
    ]);
    expect(await saveOperatorName(api, "  Dana  ")).toBe("Dana");
    expect(requests[0]).toMatchObject({
      method: "PUT",
      url: "/api/v1/settings/operator",
      body: { operator_name: "Dana" },
    });
    expect(await saveOperatorName(api, "   ")).toBeNull();
    expect(requests[1].body).toEqual({ operator_name: null });
  });
});
