import { describe, expect, it } from "vitest";
import { fakeClient, errorBody, type FakeRoute, type RecordedRequest } from "@/test/fixtures";
import { CatalogueUnavailableError, resolveTypeIds } from "./resolveTypeIds";

function queryOf(req: RecordedRequest, key: string): string {
  return new URL(`http://fake${req.url}`).searchParams.get(key) ?? "";
}

function type(id: string, name: string) {
  return {
    id,
    name,
    colour: "#f97316",
    kind: "object" as const,
    default_severity: null,
    hotkey: null,
    group: null,
    archived: false,
    origin: "user" as const,
  };
}

describe("resolveTypeIds", () => {
  it("reuses an exact match, case- and whitespace-insensitively, and never a mere substring hit", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: () => ({
          items: [type("t-substring", "big dump truck thing"), type("t-exact", "dump_truck")],
          next_cursor: null,
        }),
      },
    ]);
    const ids = await resolveTypeIds(api, ["Dump  Truck"]);
    expect(ids).toEqual(["t-exact"]);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("creates a missing name as an object type", async () => {
    const routes: FakeRoute[] = [
      { method: "GET", path: /\/catalogue\/types$/, body: { items: [], next_cursor: null } },
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: type("t-new", "bulldozer") },
    ];
    const { api, requests } = fakeClient(routes);
    const ids = await resolveTypeIds(api, ["bulldozer"]);
    expect(ids).toEqual(["t-new"]);
    const created = requests.find((r) => r.method === "POST");
    expect(created?.body).toEqual({ name: "bulldozer", kind: "object" });
  });

  it("re-lists and takes the match on a 409 type_exists create race", async () => {
    let listCalls = 0;
    const routes: FakeRoute[] = [
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: () => {
          listCalls += 1;
          return { items: listCalls === 1 ? [] : [type("t-race", "excavator")], next_cursor: null };
        },
      },
      {
        method: "POST",
        path: /\/catalogue\/types$/,
        status: 409,
        body: errorBody("type_exists", "The catalogue already has a type called excavator.", {
          type_id: "t-race",
        }),
      },
    ];
    const { api } = fakeClient(routes);
    const ids = await resolveTypeIds(api, ["excavator"]);
    expect(ids).toEqual(["t-race"]);
    expect(listCalls).toBe(2);
  });

  it("throws the typed error on catalogue_unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "catalogue.db could not be opened"),
      },
    ]);
    await expect(resolveTypeIds(api, ["excavator"])).rejects.toBeInstanceOf(CatalogueUnavailableError);
  });

  it("preserves order across mixed matches and creates", async () => {
    const routes: FakeRoute[] = [
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: (req) => {
          const q = queryOf(req, "q");
          return { items: q === "truck" ? [type("t-truck", "truck")] : [], next_cursor: null };
        },
      },
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: type("t-crane", "crane") },
    ];
    const { api } = fakeClient(routes);
    const ids = await resolveTypeIds(api, ["crane", "truck"]);
    expect(ids).toEqual(["t-crane", "t-truck"]);
  });

  it("resolves a repeated class once, by the same normalisation, keeping first-seen order", async () => {
    const routes: FakeRoute[] = [
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        body: (req) => {
          const q = queryOf(req, "q");
          return { items: /truck/i.test(q) ? [type("t-truck", "dump truck")] : [], next_cursor: null };
        },
      },
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: type("t-crane", "crane") },
    ];
    const { api, requests } = fakeClient(routes);
    const ids = await resolveTypeIds(api, ["crane", "Dump Truck", "Crane ", "dump_truck", "dump-truck"]);
    expect(ids).toEqual(["t-crane", "t-truck"]);
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(2);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });
});
