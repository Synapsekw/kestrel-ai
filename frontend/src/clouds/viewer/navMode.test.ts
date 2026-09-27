// frontend/src/clouds/viewer/navMode.test.ts
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MOUSE, mouseButtonsFor, resolveNavMode } from "./navMode";

describe("navigation modes", () => {
  it("spells three's mouse actions out exactly", () => {
    expect(MOUSE.ROTATE).toBe(THREE.MOUSE.ROTATE);
    expect(MOUSE.DOLLY).toBe(THREE.MOUSE.DOLLY);
    expect(MOUSE.PAN).toBe(THREE.MOUSE.PAN);
  });

  it("orbit rotates on the left button and pans on the right", () => {
    expect(mouseButtonsFor("orbit")).toEqual({ LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN });
  });

  it("pan swaps the buttons so a left drag pans", () => {
    expect(mouseButtonsFor("pan")).toEqual({ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE });
  });

  it("applies every mode, fly included (C-V2)", () => {
    expect(resolveNavMode("pan")).toBe("pan");
    expect(resolveNavMode("orbit")).toBe("orbit");
    expect(resolveNavMode("fly")).toBe("fly");
  });
});
