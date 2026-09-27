import type { components } from "@contract/client";
import { render } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleCloud } from "@/test/cloudFixtures";
import { CloudViewer, type CloudViewerHandle, type CloudViewerProps } from "./CloudViewer";
import type { EngineOptions } from "./viewer/engine";
import { resolveNavMode, type AppliedNavMode } from "./viewer/navMode";
import type { NavMode } from "./viewer/types";

// A fake engine per createEngine call, recording what the shell applies to it: the shell's state
// handling is tested here without WebGL (jsdom has none).
interface FakeEngine {
  options: EngineOptions;
  calls: [string, unknown][];
}
const engines: FakeEngine[] = [];

vi.mock("./viewer/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./viewer/engine")>();
  return {
    ...actual,
    createEngine: (options: EngineOptions) => {
      const fake: FakeEngine = { options, calls: [] };
      engines.push(fake);
      let nav: AppliedNavMode = "orbit";
      const record =
        (name: string) =>
        (arg?: unknown): void => {
          fake.calls.push([name, arg]);
        };
      return {
        setMaterial: record("setMaterial"),
        setColourMode: record("setColourMode"),
        setClassVisibility: record("setClassVisibility"),
        setBudget: record("setBudget"),
        setEdl: record("setEdl"),
        goToPose: record("goToPose"),
        setNavMode(mode: NavMode) {
          fake.calls.push(["setNavMode", mode]);
          nav = resolveNavMode(mode, nav);
        },
        navMode: () => nav,
        onFrame: () => () => {},
        dispose: record("dispose"),
      };
    },
  };
});

const base: CloudViewerProps = {
  cloud: exampleCloud,
  octreeUrl: "http://127.0.0.1:1/octree/",
  token: "t",
  budget: 3_000_000,
  colour: "rgb",
  elevationRange: [0, 1],
  pointSize: 1,
};

/** The colour the engine draws with now: the last colour-carrying call. */
function appliedColour(e: FakeEngine): unknown {
  for (let i = e.calls.length - 1; i >= 0; i--) {
    const [name, arg] = e.calls[i];
    if (name === "setColourMode") return arg;
    if (name === "setMaterial") return (arg as { colour: unknown }).colour;
  }
  return e.options.material.colour;
}

beforeEach(() => {
  engines.length = 0;
});

describe("CloudViewer shell state (plan Ruling 12)", () => {
  it("keeps a colour set through the handle when the point size or elevation range changes", () => {
    const ref = createRef<CloudViewerHandle>();
    const { rerender } = render(<CloudViewer ref={ref} {...base} />);
    ref.current!.setColourMode("intensity");
    rerender(<CloudViewer ref={ref} {...base} pointSize={2} />);
    const e = engines[0];
    expect(appliedColour(e)).toBe("intensity");
    const lastMaterial = e.calls.filter(([n]) => n === "setMaterial").at(-1)![1];
    expect(lastMaterial).toEqual({ colour: "intensity", elevationRange: [0, 1], pointSize: 2 });
    rerender(<CloudViewer ref={ref} {...base} pointSize={2} elevationRange={[5, 9]} />);
    expect(appliedColour(e)).toBe("intensity");
  });

  it("last write wins: a later colour prop change replaces the handle's colour", () => {
    const ref = createRef<CloudViewerHandle>();
    const { rerender } = render(<CloudViewer ref={ref} {...base} />);
    ref.current!.setColourMode("intensity");
    rerender(<CloudViewer ref={ref} {...base} colour="classification" />);
    expect(appliedColour(engines[0])).toBe("classification");
    rerender(<CloudViewer ref={ref} {...base} colour="classification" pointSize={3} />);
    expect(appliedColour(engines[0])).toBe("classification");
  });
});

describe("CloudViewer shell state across an engine rebuild", () => {
  it("re-applies the navigation mode and the hidden classes to a new engine", () => {
    const ref = createRef<CloudViewerHandle>();
    const { rerender } = render(<CloudViewer ref={ref} {...base} />);
    ref.current!.setNavMode("pan");
    ref.current!.setNavMode("fly"); // ignored until V2 (Ruling 2): pan stays
    ref.current!.setClassVisibility(new Set([2, 6]));
    ref.current!.setColourMode("intensity");
    rerender(<CloudViewer ref={ref} {...base} octreeUrl="http://127.0.0.1:1/other/" />);
    expect(engines).toHaveLength(2);
    const e = engines[1];
    expect(e.calls).toContainEqual(["setNavMode", "pan"]);
    const hidden = e.calls.filter(([n]) => n === "setClassVisibility").at(-1)?.[1] as ReadonlySet<number>;
    expect([...hidden].sort()).toEqual([2, 6]);
    expect(e.options.material.colour).toBe("intensity");
    expect(ref.current!.navMode()).toBe("pan");
  });

  it("answers the shell's navigation mode when no engine exists", () => {
    const ref = createRef<CloudViewerHandle>();
    const { unmount } = render(<CloudViewer ref={ref} {...base} />);
    const h = ref.current!;
    expect(h.navMode()).toBe("orbit");
    unmount();
    h.setNavMode("pan");
    expect(h.navMode()).toBe("pan");
    h.setNavMode("fly");
    expect(h.navMode()).toBe("pan");
  });
});

describe("goToPose", () => {
  it("takes C-C0's stored CloudViewPose without a cast", () => {
    const ref = createRef<CloudViewerHandle>();
    render(<CloudViewer ref={ref} {...base} />);
    const stored: components["schemas"]["CloudViewPose"] = {
      position: [0, -10, 10],
      target: [0, 0, 0],
      up: [0, 0, 1],
      fov_deg: 60,
    };
    expect(() => ref.current!.goToPose(stored)).not.toThrow(); // `tsc -b` is the real check
  });
});
