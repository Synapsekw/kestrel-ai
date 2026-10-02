import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOPIC_ROW_HEIGHT, TopicList, TopicPanel } from "./TopicPanel";

describe("TopicPanel", () => {
  it("renders header, eye, tools, filters, then the list", () => {
    const toggle = vi.fn();
    const draw = vi.fn();
    render(
      <TopicPanel
        title="Findings"
        count={14}
        visible={{ value: true, toggle }}
        tools={[{ id: "pt", icon: "pin", label: "Finding point", shortcut: "M", onClick: draw }]}
        filters={<p>filters</p>}
      >
        <p>list</p>
      </TopicPanel>,
    );
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide findings" }));
    expect(toggle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Finding point" }));
    expect(draw).toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("filters")).toBeLessThan(text.indexOf("list"));
  });

  it("a disabled tool names its reason", () => {
    render(
      <TopicPanel
        title="Drawings"
        tools={[
          {
            id: "k",
            icon: "align",
            label: "Align drawing",
            disabledReason: "Choose a drawing first",
            onClick: () => {},
          },
        ]}
      >
        <p />
      </TopicPanel>,
    );
    expect(screen.getByRole("button", { name: "Align drawing — Choose a drawing first" })).toBeDisabled();
  });

  it("eye reads Show when hidden", () => {
    render(
      <TopicPanel title="AI" visible={{ value: false, toggle: () => {} }}>
        <p />
      </TopicPanel>,
    );
    expect(screen.getByRole("button", { name: "Show AI" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("TopicList", () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, label: `Finding ${i}` }));

  it("renders only a window of a long list", () => {
    render(<TopicList label="Findings" items={items} selectedId={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("option").length).toBeLessThan(60);
  });

  it("marks the selected row and scrolls it into view", () => {
    const { container } = render(
      <TopicList label="Findings" items={items} selectedId="f300" onSelect={() => {}} />,
    );
    const scroller = container.querySelector('[role="listbox"]') as HTMLElement;
    // scrollToIndex scrolls minimally: the row ends up flush with the bottom of the (fallback 600px) viewport.
    const top = 300 * TOPIC_ROW_HEIGHT;
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBeLessThanOrEqual(top);
    expect(scroller.scrollTop + 600).toBeGreaterThanOrEqual(top + TOPIC_ROW_HEIGHT);
    expect(screen.getByRole("option", { name: /Finding 300/ })).toHaveAttribute("aria-selected", "true");
  });

  it("selects on click", () => {
    const onSelect = vi.fn();
    render(<TopicList label="Findings" items={items.slice(0, 3)} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("option", { name: /Finding 1/ }));
    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("shows the empty state", () => {
    render(
      <TopicList label="Findings" items={[]} selectedId={null} onSelect={() => {}} empty={<p>none yet</p>} />,
    );
    expect(screen.getByText("none yet")).toBeInTheDocument();
  });

  describe("with a ResizeObserver", () => {
    const observed: Element[] = [];
    afterEach(() => {
      vi.unstubAllGlobals();
      observed.length = 0;
    });

    it("observes the list once items arrive after an empty first render", () => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe(el: Element) {
            observed.push(el);
          }
          unobserve() {}
          disconnect() {}
        },
      );
      const { rerender } = render(
        <TopicList
          label="Findings"
          items={[]}
          selectedId={null}
          onSelect={() => {}}
          empty={<p>none yet</p>}
        />,
      );
      rerender(
        <TopicList
          label="Findings"
          items={[{ id: "f1", label: "Crack" }]}
          selectedId={null}
          onSelect={() => {}}
          empty={<p>none yet</p>}
        />,
      );
      expect(observed).toContain(screen.getByRole("listbox", { name: "Findings" }));
    });
  });
});
