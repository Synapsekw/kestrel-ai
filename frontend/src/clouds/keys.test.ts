import { describe, expect, it } from "vitest";
import { GLOBAL_KEYS, KEYMAP, REVIEW_KEYS, WORKSPACE_KEYS, findCollisions, type KeyLike } from "@/ui/keymap";
import { cloudShortcut, resolveCloudKey, reviewKeysLive } from "./keys";

const ev = (key: string, mods: Partial<Omit<KeyLike, "key">> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("the point cloud keys (spec §6 Keyboard)", () => {
  it("binds the palette and view keys the spec lists", () => {
    const chords = Object.fromEntries(WORKSPACE_KEYS.clouds.map((e) => [e.action, e.keys.join(" ")]));
    expect(chords).toEqual({
      orbit: "O",
      fly: "W",
      point: "P",
      "measure-length": "L",
      height: "Z",
      verticality: "U",
      area: "Q",
      profile: "E",
      "clipping-box": "C",
      "finding-marker": "M",
      "photo-link": "I",
      "next-ring": "N",
      "view-top": "Alt+1",
      "view-front": "Alt+2",
      "view-side": "Alt+3",
      "view-iso": "Alt+4",
    });
    expect(WORKSPACE_KEYS["clouds.fly"].flatMap((e) => e.keys)).toEqual(["W", "A", "S", "D", "Q", "E"]);
    expect(cloudShortcut("area")).toBe("Q");
    expect(() => cloudShortcut("no-such-tool")).toThrow();
  });

  it("gives no two C tools one key, and no C key equals a global or review key", () => {
    expect(findCollisions(WORKSPACE_KEYS.clouds)).toEqual([]);
    expect(findCollisions(WORKSPACE_KEYS["clouds.fly"])).toEqual([]);
    expect(findCollisions([...GLOBAL_KEYS, ...REVIEW_KEYS, ...WORKSPACE_KEYS.clouds])).toEqual([]);
    expect(findCollisions(KEYMAP)).toEqual([]);
  });

  it("resolves global, review and tool keys while orbiting", () => {
    expect(resolveCloudKey(ev("q"), "orbit")).toEqual({ scope: "clouds", action: "area" });
    expect(resolveCloudKey(ev("1", { altKey: true }), "orbit")).toEqual({
      scope: "clouds",
      action: "view-top",
    });
    expect(resolveCloudKey(ev("1"), "orbit")).toEqual({ scope: "review", action: "severity" });
    expect(resolveCloudKey(ev("t"), "orbit")).toEqual({ scope: "review", action: "type-picker" });
    expect(resolveCloudKey(ev("f"), "pan")).toEqual({ scope: "global", action: "fit" });
    expect(resolveCloudKey(ev("w"), "orbit")).toEqual({ scope: "clouds", action: "fly" });
    expect(resolveCloudKey(ev("j"), "orbit")).toBeNull();
  });

  it("suspends the review and tool keys in fly mode, keeping the fly and global keys", () => {
    expect(reviewKeysLive("fly")).toBe(false);
    expect(reviewKeysLive("orbit")).toBe(true);
    expect(resolveCloudKey(ev("a"), "fly")).toEqual({
      scope: "clouds.fly",
      action: "move-left",
      fast: false,
    });
    expect(resolveCloudKey(ev("A", { shiftKey: true }), "fly")).toEqual({
      scope: "clouds.fly",
      action: "move-left",
      fast: true,
    });
    expect(resolveCloudKey(ev("w"), "fly")).toEqual({
      scope: "clouds.fly",
      action: "move-forward",
      fast: false,
    });
    expect(resolveCloudKey(ev("1"), "fly")).toBeNull();
    expect(resolveCloudKey(ev("x"), "fly")).toBeNull();
    expect(resolveCloudKey(ev("p"), "fly")).toBeNull();
    expect(resolveCloudKey(ev("Escape"), "fly")).toEqual({ scope: "global", action: "cancel" });
    expect(resolveCloudKey(ev("a", { ctrlKey: true }), "fly")).toBeNull();
  });
});
