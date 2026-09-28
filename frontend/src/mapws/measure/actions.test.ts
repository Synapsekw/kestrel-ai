import { beforeEach, describe, expect, it } from "vitest";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import {
  AUG,
  DESIGN,
  DSM_SEP,
  LAYERS,
  MAP_SEP,
  MEASURE_ID,
  MEASURE_ID_2,
  SEP,
  SHOWN_ALL,
  UTM38,
  measurement,
} from "@/mapws/test/w3Fixtures";
import {
  MAX_MEASURE_VERTICES,
  MeasureRefusal,
  PROFILE_NEEDS_ELEVATION,
  createFailure,
  createMeasurement,
  isMeasureRefusal,
  measurementBody,
  removeMeasurement,
} from "./actions";
import { useGoneLayers } from "@/mapws/annotations/bindings";
import { useMeasurementsStore } from "./store";
import profileTool from "@/mapws/tools/profile.tool";

const ctx = {
  view: { l: AUG, r: SEP, mode: "single" as const },
  layers: LAYERS,
  shown: SHOWN_ALL,
};

describe("measurementBody", () => {
  it("a distance: the body drops repeated vertices and carries the right date's DSM and map", () => {
    expect(
      measurementBody(
        "distance",
        [
          [0, 0],
          [30, 40],
          [30, 40],
        ],
        ctx,
      ),
    ).toEqual({
      kind: "distance",
      vertices: [
        [0, 0],
        [30, 40],
      ],
      surface_ids: [DSM_SEP],
      map_id: MAP_SEP,
    });
  });

  it("an area sends its ring open (M-C0) and no surfaces", () => {
    expect(
      measurementBody(
        "area",
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
        ctx,
      ),
    ).toEqual({
      kind: "area",
      vertices: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      map_id: MAP_SEP,
    });
  });

  it("a profile carries its default surfaces, reference first", () => {
    expect(
      measurementBody(
        "profile",
        [
          [0, 0],
          [5, 5],
        ],
        ctx,
      ).surface_ids,
    ).toEqual([DESIGN, DSM_SEP]);
  });

  it("a layer dropped this session is never sent (P4)", () => {
    const gone = { ...SHOWN_ALL, gone: new Set([`surface:${DSM_SEP}`]) };
    const body = measurementBody(
      "distance",
      [
        [0, 0],
        [30, 40],
      ],
      { ...ctx, shown: gone },
    );
    expect(body).not.toHaveProperty("surface_ids");
  });

  it("refuses what the server would refuse, before sending", () => {
    expect(() =>
      measurementBody(
        "distance",
        [
          [1, 1],
          [1, 1],
        ],
        ctx,
      ),
    ).toThrow(MeasureRefusal);
    expect(() =>
      measurementBody(
        "area",
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
        ctx,
      ),
    ).toThrow("at least three corners");
    const many = Array.from({ length: MAX_MEASURE_VERTICES + 1 }, (_, i) => [i, i % 2]);
    expect(() => measurementBody("distance", many, ctx)).toThrow("at most 5000");
    const bare = { ...ctx, layers: LAYERS.filter((l) => l.kind !== "surface") };
    expect(() =>
      measurementBody(
        "profile",
        [
          [0, 0],
          [5, 5],
        ],
        bare,
      ),
    ).toThrow(PROFILE_NEEDS_ELEVATION);
  });
});

describe("createMeasurement", () => {
  it("posts the body and returns the server's row", async () => {
    const saved = measurement("distance");
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/map-measurements$/, status: 201, body: saved },
    ]);
    const out = await createMeasurement(
      api,
      PROJECT_ID,
      "distance",
      [
        [0, 0],
        [30, 40],
      ],
      ctx,
    );
    expect(out.id).toBe(saved.id);
    expect(requests[0].body).toMatchObject({
      kind: "distance",
      surface_ids: [DSM_SEP],
    });
  });

  it("a client refusal rejects without a request", async () => {
    const { api, requests } = fakeClient([]);
    const e = await createMeasurement(api, PROJECT_ID, "distance", [[0, 0]], ctx).catch(
      (err: unknown) => err,
    );
    expect(e).toBeInstanceOf(MeasureRefusal);
    expect(createFailure(e)).toBe("A line needs two different points.");
    expect(requests).toHaveLength(0);
  });

  it("explains the server's refusals", async () => {
    const fail = async (status: number, code: string) => {
      const { api } = fakeClient([
        {
          method: "POST",
          path: /\/map-measurements$/,
          status,
          body: errorBody(code, code),
        },
      ]);
      return createFailure(
        await createMeasurement(
          api,
          PROJECT_ID,
          "profile",
          [
            [0, 0],
            [5, 5],
          ],
          ctx,
        ).catch((e: unknown) => e),
      );
    };
    expect(await fail(422, "no_surface_under_line")).toBe("No elevation under this line");
    expect(await fail(409, "not_ready")).toBe("A surface is still being built — try again when it is ready");
    expect(await fail(501, "not_implemented")).toBe("Measurements need the map measurement backend (M-B4)");
  });

  it("a client refusal and the server's no_surface_under_line are refusals; other failures are not (T5a)", async () => {
    const fail = async (status: number, code: string) => {
      const { api } = fakeClient([
        { method: "POST", path: /\/map-measurements$/, status, body: errorBody(code, code) },
      ]);
      return createMeasurement(
        api,
        PROJECT_ID,
        "distance",
        [
          [0, 0],
          [5, 5],
        ],
        ctx,
      ).catch((e: unknown) => e);
    };
    expect(isMeasureRefusal(new MeasureRefusal("x"))).toBe(true);
    expect(isMeasureRefusal(await fail(422, "no_surface_under_line"))).toBe(true);
    expect(isMeasureRefusal(await fail(409, "not_ready"))).toBe(false);
    expect(isMeasureRefusal(await fail(500, "internal"))).toBe(false);
    expect(isMeasureRefusal(new Error("boom"))).toBe(false);
  });
});

describe("removeMeasurement", () => {
  beforeEach(() =>
    useMeasurementsStore
      .getState()
      .set([measurement("distance"), { ...measurement("area"), id: MEASURE_ID_2 }], false),
  );

  it("deletes, then drops the row from the layer at once", async () => {
    const { api, requests } = fakeClient([
      {
        method: "DELETE",
        path: /\/map-measurements\/[^/]+$/,
        status: 204,
      },
    ]);
    await removeMeasurement(api, PROJECT_ID, MEASURE_ID);
    expect(requests[0].method).toBe("DELETE");
    expect(useMeasurementsStore.getState().items.map((m) => m.id)).toEqual([MEASURE_ID_2]);
  });

  it("an own PATCH updates the row in place (W3-18)", () => {
    useMeasurementsStore.getState().patch(MEASURE_ID, { name: "Haul road" });
    const items = useMeasurementsStore.getState().items;
    expect(items[0].name).toBe("Haul road");
    expect(items[1].name).toBe("Area 1");
  });
});

describe("the profile tool", () => {
  it("is disabled without an elevation layer, with the spec's reason", () => {
    const base = { frame: UTM38, selection: null, surveys: [], r: SEP };
    expect(profileTool.disabledReason?.({ ...base, layers: LAYERS })).toBeNull();
    expect(
      profileTool.disabledReason?.({
        ...base,
        layers: LAYERS.filter((l) => l.kind !== "surface"),
      }),
    ).toBe(PROFILE_NEEDS_ELEVATION);
  });

  it("is disabled when every surface is gone this session (M-W3 P4)", () => {
    const base = { frame: UTM38, selection: null, surveys: [], r: SEP, layers: LAYERS };
    const surfaces = LAYERS.filter((l) => l.kind === "surface").map((l) => `surface:${l.id}`);
    useGoneLayers.setState({ gone: new Set(surfaces) });
    try {
      expect(profileTool.disabledReason?.(base)).toBe(PROFILE_NEEDS_ELEVATION);
    } finally {
      useGoneLayers.setState({ gone: new Set() });
    }
  });
});
