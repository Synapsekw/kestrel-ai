import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRailStore, RAIL_STORAGE_PREFIX } from "./railStore";

const TOPICS = ["layers", "findings", "measure"];
const KEY = `${RAIL_STORAGE_PREFIX}maps`;

describe("railStore", () => {
  beforeEach(() => localStorage.clear());

  it("starts open on the default topic", () => {
    const s = createRailStore("maps", TOPICS, "findings").getState();
    expect(s.open).toBe(true);
    expect(s.topic).toBe("findings");
  });

  it("clicking the open topic closes, another topic switches", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().openTopic("findings");
    expect(store.getState().open).toBe(false);
    store.getState().openTopic("measure");
    expect(store.getState()).toMatchObject({ open: true, topic: "measure" });
  });

  it("toggle reopens the last topic", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().openTopic("measure");
    store.getState().toggle();
    expect(store.getState().open).toBe(false);
    store.getState().toggle();
    expect(store.getState()).toMatchObject({ open: true, topic: "measure" });
  });

  it("revealTopicFor switches only while open, and ignores null", () => {
    const store = createRailStore("maps", TOPICS, "findings");
    store.getState().revealTopicFor("measure");
    expect(store.getState().topic).toBe("measure");
    store.getState().close();
    store.getState().revealTopicFor("layers");
    expect(store.getState()).toMatchObject({ open: false, topic: "measure" });
    store.getState().revealTopicFor(null);
    expect(store.getState().topic).toBe("measure");
  });

  it("persists and restores per workspace", () => {
    createRailStore("maps", TOPICS, "findings").getState().openTopic("layers");
    expect(createRailStore("maps", TOPICS, "findings").getState().topic).toBe("layers");
    expect(createRailStore("clouds", TOPICS, "findings").getState().topic).toBe("findings");
  });

  it.each([["{"], [JSON.stringify({ open: true, topic: "gone" })], [JSON.stringify(42)]])(
    "falls back to the default on stored %s",
    (raw) => {
      localStorage.setItem(KEY, raw);
      expect(createRailStore("maps", TOPICS, "findings").getState()).toMatchObject({
        open: true,
        topic: "findings",
      });
    },
  );

  it("survives a storage that throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createRailStore("maps", TOPICS, "findings");
    expect(() => store.getState().openTopic("measure")).not.toThrow();
    expect(store.getState().topic).toBe("measure");
    get.mockRestore();
    set.mockRestore();
  });
});
