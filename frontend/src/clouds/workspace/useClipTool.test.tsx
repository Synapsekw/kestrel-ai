import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { exampleCloud } from "@/test/cloudFixtures";
import { FAKE_PICK } from "@/test/fakeCloudViewer";
import { clipKey } from "./clip";
import { useClipTool } from "./useClipTool";

const setClipBox = vi.fn();

function Harness({ running = true }: { running?: boolean }) {
  const viewer = useRef({ setClipBox } as unknown as CloudViewerHandle);
  const clip = useClipTool({ cloud: exampleCloud, viewer, running });
  return (
    <>
      <button type="button" onClick={() => clip.tool.onArm?.()}>
        arm
      </button>
      <button type="button" onClick={() => clip.tool.onPick?.(FAKE_PICK)}>
        pick
      </button>
      <div data-testid="hint">{clip.tool.hint}</div>
      <output>{clip.box ? clip.box.centre.join(",") : "none"}</output>
    </>
  );
}

beforeEach(() => {
  setClipBox.mockClear();
  localStorage.clear();
});

describe("the clip-box tool (plan Ruling 4)", () => {
  it("places the default box on arm, recentres on a pick and remembers it for the cloud", async () => {
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent("none");
    await userEvent.click(screen.getByRole("button", { name: "arm" }));
    expect(setClipBox).toHaveBeenLastCalledWith(expect.objectContaining({ yawDeg: 0 }), "show_inside");
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    expect(screen.getByRole("status")).toHaveTextContent(`${FAKE_PICK.x},${FAKE_PICK.y},${FAKE_PICK.z}`);
    expect(JSON.parse(localStorage.getItem(clipKey(exampleCloud.id))!).centre).toEqual([
      FAKE_PICK.x,
      FAKE_PICK.y,
      FAKE_PICK.z,
    ]);
  });

  it("edits mode and size from the hint bar, and clears", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "arm" }));
    await userEvent.click(screen.getByRole("radio", { name: "Highlight" }));
    expect(setClipBox).toHaveBeenLastCalledWith(expect.anything(), "highlight_inside");
    fireEvent.change(screen.getByLabelText("Box width (m)"), { target: { value: "12" } });
    expect((setClipBox.mock.lastCall![0] as { size: number[] }).size[0]).toBe(12);
    await userEvent.click(screen.getByRole("button", { name: "Clear box" }));
    expect(setClipBox).toHaveBeenLastCalledWith(null, "show_inside");
    expect(localStorage.getItem(clipKey(exampleCloud.id))).toBeNull();
  });

  it("places a box centred on the pick after the box was cleared", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "arm" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear box" }));
    expect(screen.getByRole("status")).toHaveTextContent("none");
    expect(screen.getByTestId("hint")).toHaveTextContent("No box: click the cloud to place one");
    await userEvent.click(screen.getByRole("button", { name: "pick" }));
    const centre = [FAKE_PICK.x, FAKE_PICK.y, FAKE_PICK.z];
    expect(screen.getByRole("status")).toHaveTextContent(centre.join(","));
    expect(setClipBox).toHaveBeenLastCalledWith(expect.objectContaining({ centre }), "show_inside");
  });

  it("re-applies a remembered box once the view runs", () => {
    localStorage.setItem(
      clipKey(exampleCloud.id),
      JSON.stringify({ centre: [1, 2, 3], size: [4, 5, 6], yaw_deg: 30, mode: "highlight_inside" }),
    );
    const { rerender } = render(<Harness running={false} />);
    expect(setClipBox).not.toHaveBeenCalled();
    rerender(<Harness running />);
    expect(setClipBox).toHaveBeenLastCalledWith(
      { centre: [1, 2, 3], size: [4, 5, 6], yawDeg: 30 },
      "highlight_inside",
    );
  });
});
