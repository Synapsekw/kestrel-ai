import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createRailStore } from "./railStore";
import { WorkspaceRail, type RailTopic } from "./WorkspaceRail";

const topics: RailTopic[] = [
  { id: "layers", label: "Layers", icon: "layers", group: "shared", body: <p>layers body</p> },
  { id: "findings", label: "Findings", icon: "findings", group: "shared", body: <p>findings body</p> },
  { id: "ai", label: "AI", icon: "detect", group: "workspace", badge: 3, body: <p>ai body</p> },
];

function setup(inspectorOpen = false) {
  const store = createRailStore(
    "maps",
    topics.map((t) => t.id),
    "findings",
  );
  const utils = render(
    <WorkspaceRail
      label="Map"
      store={store}
      nav={null}
      topics={topics}
      inspectorOpen={inspectorOpen}
      bottomInset={140}
    />,
  );
  return { store, ...utils };
}

describe("WorkspaceRail", () => {
  beforeEach(() => localStorage.clear());

  it("shows the default topic's panel as a labelled region", () => {
    setup();
    expect(screen.getByRole("region", { name: "Findings" })).toHaveTextContent("findings body");
    expect(screen.getByRole("button", { name: "Findings" })).toHaveAttribute("aria-pressed", "true");
  });

  it("one panel at a time; clicking the open topic closes it", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.getByRole("region", { name: "Layers" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Findings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("\\ toggles the panel", () => {
    setup();
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.getByRole("region", { name: "Findings" })).toBeInTheDocument();
  });

  it("shows a badge only when > 0", () => {
    setup();
    expect(screen.getByRole("button", { name: "AI, 3 waiting" })).toBeInTheDocument();
  });

  it("separates shared and workspace topics", () => {
    setup();
    const bar = screen.getByRole("toolbar", { name: "Map" });
    expect(bar.querySelectorAll('[role="separator"]').length).toBe(1);
  });

  it("closes the panel when the inspector opens on a narrow window", () => {
    window.innerWidth = 1100;
    const { store, rerender } = setup(false);
    rerender(
      <WorkspaceRail label="Map" store={store} nav={null} topics={topics} inspectorOpen bottomInset={140} />,
    );
    expect(store.getState().open).toBe(false);
    window.innerWidth = 1600;
  });

  it("keeps the panel on a wide window", () => {
    window.innerWidth = 1600;
    const { store, rerender } = setup(false);
    rerender(
      <WorkspaceRail label="Map" store={store} nav={null} topics={topics} inspectorOpen bottomInset={140} />,
    );
    expect(store.getState().open).toBe(true);
  });

  it("re-renders on store changes from outside", () => {
    const { store } = setup();
    act(() => store.getState().openTopic("ai"));
    expect(screen.getByRole("region", { name: "AI" })).toBeInTheDocument();
  });
});
