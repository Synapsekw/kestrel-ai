import { beforeEach, describe, expect, it } from "vitest";
import { viewOut } from "@/test/cloudViewFixtures";
import { subjectKey, useViewStore } from "./viewStore";

describe("the view store", () => {
  beforeEach(() => useViewStore.getState().reset(null, null));

  it("keys subjects by kind and id", () => {
    expect(subjectKey({ kind: "finding", id: "f1" })).toBe("finding:f1");
    expect(subjectKey({ kind: "cloud_measurement", id: "m1" })).toBe("cloud_measurement:m1");
  });

  it("indexes the listed views and replaces one on upload", () => {
    const s = useViewStore.getState();
    s.reset("p1", "c1");
    expect(useViewStore.getState().views).toBeNull();
    s.setViews([viewOut(), viewOut({ subject_kind: "cloud_measurement", subject_id: "m1" })]);
    expect(Object.keys(useViewStore.getState().views!)).toEqual(["finding:f1", "cloud_measurement:m1"]);
    s.putView(viewOut({ sha256: "new" }));
    expect(useViewStore.getState().views!["finding:f1"].sha256).toBe("new");
  });

  it("tracks busy subjects and resets everything", () => {
    const s = useViewStore.getState();
    s.reset("p1", "c1");
    s.setBusy("finding:f1", true);
    expect(useViewStore.getState().busy).toEqual({ "finding:f1": true });
    s.setBusy("finding:f1", false);
    expect(useViewStore.getState().busy).toEqual({});
    s.setBulk({ done: 1, total: 3 });
    s.setReady(true);
    s.reset(null, null);
    expect(useViewStore.getState()).toMatchObject({
      projectId: null,
      cloudId: null,
      views: null,
      busy: {},
      bulk: null,
      ready: false,
      actions: null,
    });
  });
});
