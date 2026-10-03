import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RAIL_STORAGE_PREFIX, WorkspaceRail } from "@/ui";
import { showTopic, useModelRail } from "./useModelRail";

afterEach(() => localStorage.clear());

function Harness({ onToggle = vi.fn() }: { onToggle?: (t: string) => void }) {
  const rail = useModelRail({
    running: true,
    tools: { cut: false, levels: false, headOff: false },
    onToggle,
    onView: () => {},
    modelBody: <p>model body</p>,
    findingsBody: <p>findings body</p>,
    photosBody: <p>photos body</p>,
  });
  return (
    <>
      <WorkspaceRail
        label="Model view tools"
        store={rail.store}
        nav={rail.nav}
        topics={rail.topics}
        inspectorOpen
        bottomInset={84}
      />
      <button type="button" onClick={() => showTopic(rail.store, "findings")}>
        show findings
      </button>
    </>
  );
}

describe("useModelRail", () => {
  it("opens on the Model topic and switches topics from the rail", () => {
    render(<Harness />);
    expect(screen.getByText("model body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^photos/i }));
    expect(screen.getByText("photos body")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(`${RAIL_STORAGE_PREFIX}models`)!)).toEqual({
      open: true,
      topic: "photos",
    });
  });

  it("keeps the view tools on the rail", () => {
    const onToggle = vi.fn();
    render(<Harness onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: /^cut/i }));
    expect(onToggle).toHaveBeenCalledWith("cut");
  });

  it("showTopic opens a topic without closing it when it is already open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "show findings" }));
    fireEvent.click(screen.getByRole("button", { name: "show findings" }));
    expect(screen.getByText("findings body")).toBeInTheDocument();
  });
});
