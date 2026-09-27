import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { HintBar } from "./HintBar";
import { Palette } from "./Palette";
import { ENTRY, type CloudToolId } from "./tools";
import type { WorkspaceTool } from "./types";
import { useWorkspaceTool } from "./useWorkspaceTool";

// The engine's nav mode and its frame listeners, so a test can play the engine leaving fly itself.
let engineNav = "orbit";
const frames = new Set<() => void>();
const handle = {
  setNavMode: vi.fn((m: string) => {
    engineNav = m;
  }),
  setView: vi.fn(),
  navMode: () => engineNav,
  onFrame: (cb: () => void) => {
    frames.add(cb);
    return () => frames.delete(cb);
  },
};
const renderFrame = () => act(() => [...frames].forEach((cb) => cb()));

function Harness({
  tools,
  available = () => true,
}: {
  tools: WorkspaceTool[];
  available?: (id: CloudToolId) => boolean;
}) {
  const viewer = useRef(handle as unknown as CloudViewerHandle);
  const [note, setNote] = useState("");
  const [active, setActive] = useState<CloudToolId>("orbit");
  const c = useWorkspaceTool({ active, setActive, tools, viewer, enabled: true, isAvailable: available });
  return (
    <>
      <Palette active={c.active} isAvailable={available} onArm={c.arm} />
      <HintBar entry={ENTRY[c.active]} tool={c.tool} progress={null} onCancel={c.escape} />
      <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div role="dialog" aria-label="Some dialog">
        <button type="button">In the dialog</button>
      </div>
    </>
  );
}

const pressed = (name: string) =>
  screen
    .getByRole("toolbar", { name: "Point cloud tools" })
    .querySelector(`[aria-label="${name}"]`)!
    .getAttribute("aria-pressed");

afterEach(() => {
  vi.clearAllMocks();
  engineNav = "orbit";
});

describe("the workspace's tools and keys (spec §6 Keyboard, plan Ruling 3)", () => {
  it("arms a tool from its key and shows its hint", async () => {
    const onArm = vi.fn();
    render(<Harness tools={[{ id: "distance", picks: true, onArm }]} />);
    expect(pressed("Orbit")).toBe("true");
    await userEvent.keyboard("l");
    expect(pressed("Distance")).toBe("true");
    expect(onArm).toHaveBeenCalledOnce();
    expect(screen.getByTestId("cloud-hintbar")).toHaveTextContent("Click two points to measure a distance");
    expect(handle.setNavMode).toHaveBeenLastCalledWith("orbit");
    await userEvent.keyboard("h");
    expect(pressed("Pan")).toBe("true");
    expect(handle.setNavMode).toHaveBeenLastCalledWith("pan");
    await userEvent.keyboard("v");
    expect(pressed("Orbit")).toBe("true");
  });

  it("Esc drops the picks first, then returns to Orbit", async () => {
    let picks = 1;
    const onDisarm = vi.fn();
    const tool: WorkspaceTool = {
      id: "distance",
      picks: true,
      onCancel: () => {
        const had = picks > 0;
        picks = 0;
        return had;
      },
      onDisarm,
    };
    render(<Harness tools={[tool]} />);
    await userEvent.keyboard("l");
    await userEvent.keyboard("{Escape}");
    expect(pressed("Distance")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(pressed("Orbit")).toBe("true");
    expect(onDisarm).toHaveBeenCalledOnce();
  });

  it("routes Enter, Backspace and other clouds keys to the armed tool, and views to the engine", async () => {
    const onCommit = vi.fn();
    const onRemoveVertex = vi.fn();
    const onAction = vi.fn(() => true);
    render(<Harness tools={[{ id: "vertical", picks: true, onCommit, onRemoveVertex, onAction }]} />);
    await userEvent.keyboard("u");
    await userEvent.keyboard("{Enter}{Backspace}n");
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onRemoveVertex).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledWith("next-ring");
    await userEvent.keyboard("f");
    expect(handle.setView).toHaveBeenLastCalledWith("fit");
    fireEvent.keyDown(window, { key: "2", altKey: true });
    expect(handle.setView).toHaveBeenLastCalledWith("front");
  });

  it("ignores keys typed into a field or inside a dialog", async () => {
    const onCommit = vi.fn();
    render(<Harness tools={[{ id: "distance", picks: true, onCommit }]} />);
    await userEvent.keyboard("l");
    await userEvent.type(screen.getByLabelText("Note"), "ol{Enter}{Escape}");
    expect(pressed("Distance")).toBe("true");
    expect(onCommit).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "In the dialog" }).focus();
    await userEvent.keyboard("{Escape}o");
    expect(pressed("Distance")).toBe("true");
  });

  it("holds Space to pan and restores the tool's mode on release", () => {
    render(<Harness tools={[{ id: "distance", picks: true }]} />);
    fireEvent.keyDown(window, { key: " " });
    expect(handle.setNavMode).toHaveBeenLastCalledWith("pan");
    fireEvent.keyUp(window, { key: " " });
    expect(handle.setNavMode).toHaveBeenLastCalledWith("orbit");
  });

  it("releases the Space hold when the window loses focus (the keyup never arrives)", () => {
    render(<Harness tools={[{ id: "distance", picks: true }]} />);
    fireEvent.keyDown(window, { key: " " });
    expect(handle.setNavMode).toHaveBeenLastCalledWith("pan");
    fireEvent.blur(window);
    expect(handle.setNavMode).toHaveBeenLastCalledWith("orbit");
    handle.setNavMode.mockClear();
    fireEvent.keyUp(window, { key: " " });
    expect(handle.setNavMode).not.toHaveBeenCalled();
  });

  it("leaves Space to a focused button (keyboard activation)", () => {
    render(<Harness tools={[]} />);
    const button = screen
      .getByRole("toolbar", { name: "Point cloud tools" })
      .querySelector<HTMLButtonElement>('[aria-label="Distance"]')!;
    button.focus();
    const notPrevented = fireEvent.keyDown(button, { key: " " });
    expect(notPrevented).toBe(true);
    expect(handle.setNavMode).not.toHaveBeenCalledWith("pan");
  });

  it("disables what is not available and never arms it", async () => {
    render(<Harness tools={[]} available={(id) => id === "orbit" || id === "pan"} />);
    const bar = screen.getByRole("toolbar", { name: "Point cloud tools" });
    expect(bar.querySelector('[aria-label="Area"]')).toBeDisabled();
    await userEvent.keyboard("q");
    expect(pressed("Orbit")).toBe("true");
  });

  it("offers the tool's Save and Cancel in the hint bar", async () => {
    const onCommit = vi.fn();
    render(
      <Harness tools={[{ id: "area", picks: true, onCommit, canCommit: true, commitLabel: "Save area" }]} />,
    );
    await userEvent.keyboard("q");
    await userEvent.click(screen.getByRole("button", { name: /Save area/ }));
    expect(onCommit).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(pressed("Orbit")).toBe("true");
  });

  it("returns to Orbit when the engine leaves fly itself (a photo's lookThrough, C-V2 hand-off)", async () => {
    render(<Harness tools={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Fly" }));
    expect(pressed("Fly")).toBe("true");
    renderFrame(); // the engine is flying: the tool stays
    expect(pressed("Fly")).toBe("true");
    engineNav = "orbit"; // lookThrough switched the engine to orbit without telling the workspace
    renderFrame();
    expect(pressed("Orbit")).toBe("true");
    expect(handle.setNavMode).toHaveBeenLastCalledWith("orbit");
  });
});
