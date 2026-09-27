import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { callsTo, emitFrame, fake, FakeCloudViewer, resetFake } from "@/test/fakeCloudViewer";
import { Gizmo } from "./Gizmo.tsx";

function Harness() {
  const viewer = useRef<CloudViewerHandle>(null);
  return (
    <>
      <FakeCloudViewer
        ref={viewer}
        cloud={undefined as never}
        octreeUrl=""
        token=""
        budget={1}
        colour="rgb"
        elevationRange={[0, 1]}
        pointSize={1}
      />
      <Gizmo viewer={viewer} running />
    </>
  );
}

beforeEach(() => resetFake());

describe("the view gizmo (spec §6)", () => {
  it("follows the camera on each frame, dimming the axes that point away", () => {
    render(<Harness />);
    expect(fake.frames.size).toBe(1);
    emitFrame({ direction: [0, 1, 0] });
    const y = screen.getByRole("button", { name: /Front view/ });
    expect(y.getAttribute("opacity")).toBe("0.45");
    expect(screen.getByRole("button", { name: /Side view/ }).getAttribute("opacity")).toBe("1");
  });

  it("goes to the named views from its heads and its grid", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /Top view \(look from above\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Iso" }));
    expect(callsTo("setView")).toEqual([["top"], ["iso"]]);
  });
});
