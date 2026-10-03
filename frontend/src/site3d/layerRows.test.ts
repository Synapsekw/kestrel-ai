import { describe, expect, it } from "vitest";
import type { SiteLayer } from "@/site3d/layers/types";
import { extraRows, groupRows, s1Rows, statusLine } from "./layerRows";

const layer = (id: string, label: string, opacity = false) =>
  ({
    id,
    label,
    attach() {},
    detach() {},
    setVisible() {},
    ...(opacity ? { setOpacity() {} } : {}),
  }) as SiteLayer;

describe("panel rows", () => {
  it("puts the model first and orthos and drawings under Imagery, with opacity where the layer has it", () => {
    const rows = s1Rows(
      [
        layer("model", "Plant model", true),
        layer("ortho:o1", "May ortho", true),
        layer("drawing:d1", "T0006"),
      ],
      { visible: { "ortho:o1": false }, opacity: { model: 0.6 } },
    );
    expect(rows.map((r) => [r.id, r.group, r.visible, r.opacity])).toEqual([
      ["model", "Model", true, 0.6],
      ["ortho:o1", "Imagery", false, 1],
      ["drawing:d1", "Imagery", true, null],
    ]);
  });

  it("keeps the model's status copy and marks a removed map unavailable", () => {
    const ls = [layer("model", "Plant model"), layer("ortho:o1", "May ortho"), layer("drawing:d1", "T0006")];
    const ui = { visible: {}, opacity: {}, gone: new Set(["ortho:o1", "drawing:d1"]) };
    const lines = (model: { state: "loading" | "error" | "ready" | "off"; items: number }) =>
      s1Rows(ls, { ...ui, model }).map((r) => statusLine(r.status)?.text);
    expect(lines({ state: "ready", items: 2 })).toEqual([
      "2 items",
      "This map was removed.",
      "This drawing was removed.",
    ]);
    expect(lines({ state: "loading", items: 0 })[0]).toBe("Loading");
    expect(lines({ state: "error", items: 0 })[0]).toBe("Could not load");
    expect(lines({ state: "off", items: 0 })[0]).toBe("Not shown");
    expect(s1Rows(ls, { ...ui, model: { state: "ready", items: 1 } })[0].status).toEqual({
      kind: "ready",
      note: "1 item",
    });
  });

  it("without a model layer the Plant model row still shows, off, saying why (Review Focus 1)", () => {
    const rows = (state: "none" | "off" | "loading") =>
      s1Rows([], { visible: {}, opacity: {}, model: { state, items: 0 } });
    expect(rows("none").map((r) => [r.id, r.label, r.visible, statusLine(r.status)?.text])).toEqual([
      ["model", "Plant model", false, "None yet"],
    ]);
    expect(rows("none")[0].status.kind).toBe("unavailable");
    // Ruling R-S1-15: the view could not start, so the model is "Not shown", not "Loading" forever.
    expect(statusLine(rows("off")[0].status)?.text).toBe("Not shown");
    expect(statusLine(rows("loading")[0].status)?.text).toBe("Loading");
    expect(
      s1Rows([layer("model", "Plant model")], {
        visible: {},
        opacity: {},
        model: { state: "none", items: 0 },
      }),
    ).toHaveLength(1);
  });

  it("a failed swap reads stale, not 'Could not load': the old version is still on screen (S3-9 minor 2)", () => {
    const ls = [layer("model", "Plant model")];
    const row = (model: Parameters<typeof s1Rows>[1]["model"]) =>
      s1Rows(ls, { visible: {}, opacity: {}, model })[0];
    expect(row({ state: "error", items: 0, version: 4, shown: 3 }).status).toEqual({
      kind: "error",
      message: "Stale: showing version 3. Version 4 could not load.",
    });
    expect(statusLine(row({ state: "loading", items: 2, version: 4, shown: 3 }).status)?.text).toBe(
      "Loading version 4",
    );
    // Nothing on screen yet: a plain failure.
    expect(statusLine(row({ state: "error", items: 0, version: 4, shown: null }).status)?.text).toBe(
      "Could not load",
    );
  });

  it("reads S2's rows with their live status and no opacity", () => {
    const [row] = extraRows([
      {
        id: "water",
        label: "Water",
        group: "Environment",
        visible: true,
        layer: { status: { get: () => ({ kind: "ready" as const }) } },
      },
    ]);
    expect([row.id, row.group, row.visible, row.opacity, row.status]).toEqual([
      "water",
      "Environment",
      true,
      null,
      { kind: "ready" },
    ]);
  });

  it("groups in the panel's order and drops empty groups", () => {
    const rows = [...extraRows([]), ...s1Rows([layer("model", "Plant model")], { visible: {}, opacity: {} })];
    expect(groupRows(rows).map(([g]) => g)).toEqual(["Model"]);
  });

  it("turns a status into one line of copy", () => {
    expect(statusLine({ kind: "ready" })).toBeNull();
    expect(statusLine({ kind: "ready", note: "Flat water (reduced effects)" })).toEqual({
      text: "Flat water (reduced effects)",
      tone: "muted",
    });
    expect(statusLine({ kind: "unavailable", reason: "This model has no sea." })).toEqual({
      text: "This model has no sea.",
      tone: "muted",
    });
    expect(statusLine({ kind: "error", message: "The cloud could not load: HTTP 404" })).toEqual({
      text: "The cloud could not load: HTTP 404",
      tone: "danger",
    });
    expect(statusLine({ kind: "loading" })).toEqual({ text: "Loading…", tone: "muted" });
  });
});
