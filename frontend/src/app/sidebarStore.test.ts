import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSidebarPref, SIDEBAR_STORAGE_KEY, useSidebar, writeSidebarPref } from "./sidebarStore";

describe("sidebar store", () => {
  beforeEach(() => {
    localStorage.clear();
    useSidebar.setState({ stored: false, override: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads expanded when nothing or garbage is stored", () => {
    expect(readSidebarPref()).toBe(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "not json");
    expect(readSidebarPref()).toBe(false);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ collapsed: "yes" }));
    expect(readSidebarPref()).toBe(false);
  });

  it("round-trips the preference", () => {
    writeSidebarPref(true);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe('{"collapsed":true}');
    expect(readSidebarPref()).toBe(true);
  });

  it("toggles and persists the preference on an ordinary route", () => {
    useSidebar.getState().toggle(false);
    expect(useSidebar.getState().stored).toBe(true);
    expect(readSidebarPref()).toBe(true);
    expect(useSidebar.getState().override).toBeNull();
  });

  it("on a forced route sets a per-visit override and leaves the preference alone", () => {
    useSidebar.getState().toggle(true); // forced and collapsed, so it expands for this visit
    expect(useSidebar.getState().override).toBe(false);
    expect(useSidebar.getState().stored).toBe(false);
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBeNull();
    useSidebar.getState().toggle(true);
    expect(useSidebar.getState().override).toBe(true);
    useSidebar.getState().clearOverride();
    expect(useSidebar.getState().override).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSidebarPref()).toBe(false);
    expect(() => useSidebar.getState().toggle(false)).not.toThrow();
    expect(useSidebar.getState().stored).toBe(true);
  });
});
