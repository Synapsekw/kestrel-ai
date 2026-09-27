import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeStores, renderInWorkspace } from "../test/harness";
import { useSpacePan, workspaceKeyOf } from "./useWorkspaceKeys";

function Probe() {
  useSpacePan();
  return null;
}

function setup() {
  const stores = makeStores();
  renderInWorkspace(<Probe />, { stores });
  return () => stores.tools.getState().panHold;
}

/** A focused element of `html`, appended to the body (removed after each test). */
function mount(html: string, pick = "[data-target]"): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const el = host.querySelector<HTMLElement>(pick)!;
  el.focus();
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useSpacePan (spec §5.1, Review Focus 2)", () => {
  it("holds pan while Space is down on the window and releases it on keyup", () => {
    const panHold = setup();
    fireEvent.keyDown(window, { key: " " });
    expect(panHold()).toBe(true);
    fireEvent.keyUp(window, { key: " " });
    expect(panHold()).toBe(false);
  });

  it.each([
    ["a dialog", '<div role="dialog"><span tabindex="0" data-target>x</span></div>'],
    ["a menu", '<div role="menu"><span tabindex="0" data-target>x</span></div>'],
    ["a text field", "<input data-target />"],
    ["a focused button", "<button data-target>Go</button>"],
    ["a role=button", '<div role="button" tabindex="0" data-target>Go</div>'],
    ["a slider", '<div role="slider" tabindex="0" data-target></div>'],
    ["a checkbox", '<input type="checkbox" data-target />'],
  ])("does not start a pan from %s", (_, html) => {
    const panHold = setup();
    const target = mount(html);
    const ev = fireEvent.keyDown(target, { key: " " });
    expect(panHold()).toBe(false);
    // Space keeps its default meaning (press the control, type the space).
    expect(ev).toBe(true);
  });
});

describe("workspaceKeyOf", () => {
  it("reads the fit key from the keymap", () => {
    expect(workspaceKeyOf("fit")).toBe("F");
  });
});
