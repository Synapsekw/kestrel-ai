import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createRailStore } from "./railStore";
import { WorkspaceRail, type RailTopic } from "./WorkspaceRail";

const topics: RailTopic[] = [
  {
    id: "layers",
    label: "Layers",
    icon: "layers",
    group: "shared",
    hidden: true,
    body: (
      <p>
        layers body <button type="button">first control</button>
      </p>
    ),
  },
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
    fireEvent.click(screen.getByRole("button", { name: "Layers, hidden" }));
    expect(screen.getByRole("region", { name: "Layers" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Findings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Layers, hidden" }));
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

  it("aria-controls sits on the active topic button, not the toolbar", () => {
    setup();
    const region = screen.getByRole("region", { name: "Findings" });
    expect(screen.getByRole("toolbar", { name: "Map" })).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("button", { name: "Findings" })).toHaveAttribute("aria-controls", region.id);
    expect(screen.getByRole("button", { name: "AI, 3 waiting" })).not.toHaveAttribute("aria-controls");
  });

  it("names a hidden topic's button as hidden", () => {
    setup();
    expect(screen.getByRole("button", { name: "Layers, hidden" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Findings" })).toBeInTheDocument();
  });

  it("Ctrl+Alt+\\ (AltGr layouts) toggles the panel too", () => {
    setup();
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true, altKey: true });
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a keyboard open moves focus into the panel", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: "Layers, hidden" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Layers" })).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(document.activeElement).toHaveTextContent("first control");
  });

  it("falls back to the region when the panel has no control", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: "AI, 3 waiting" }).focus();
    await user.keyboard(" ");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "AI" }));
  });

  it("a mouse open leaves focus on the rail button", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Layers, hidden" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Layers, hidden" }));
  });

  it("\\ opens with focus in the panel and closes with focus back on the topic button", () => {
    const { store } = setup();
    act(() => store.getState().close());
    fireEvent.keyDown(window, { key: "\\" });
    const region = screen.getByRole("region", { name: "Findings" });
    expect(region).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.queryByRole("region")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Findings" }));
  });

  it("closing while focus is outside the panel does not steal focus", () => {
    setup();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(window, { key: "\\" });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
