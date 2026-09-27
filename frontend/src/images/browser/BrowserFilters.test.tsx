import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { exampleSource, fakeClient, PROJECT_ID, SOURCE_ID } from "@/test/fixtures";
import { typedProject } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { BrowserFilters, SEARCH_COMMIT_MS, severityHistogram } from "./BrowserFilters";
import { DEFAULT_BROWSER_FILTERS, type BrowserFilterState } from "./filters";

function renderFilters(value: BrowserFilterState = DEFAULT_BROWSER_FILTERS, sev: number[] = [4, 3, 3, 0]) {
  const { api } = fakeClient([
    {
      method: "GET",
      path: /\/sources$/,
      body: {
        items: [{ ...exampleSource, id: SOURCE_ID, label: "Flight 14 Sep", image_count: 312 }],
        next_cursor: null,
      },
    },
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
  ]);
  const onChange = vi.fn<(f: BrowserFilterState) => void>();
  renderWithProviders(
    <BrowserFilters
      projectId={PROJECT_ID}
      value={value}
      onChange={onChange}
      index={{ sev, total: sev.length }}
    />,
    { api },
  );
  return { onChange };
}

describe("BrowserFilters", () => {
  afterEach(() => vi.useRealTimers());

  it("counts images per worst severity", () => {
    expect(severityHistogram([4, 3, 3, 0, 0])).toEqual(
      new Map([
        [4, 1],
        [3, 2],
        [0, 2],
      ]),
    );
  });

  it("offers the sources as label · count", async () => {
    const { onChange } = renderFilters();
    const source = await screen.findByRole("combobox", { name: "Flight" });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Flight 14 Sep · 312" })).toBeInTheDocument(),
    );
    fireEvent.change(source, { target: { value: SOURCE_ID } });
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_BROWSER_FILTERS, sourceId: SOURCE_ID });
  });

  it("has findings and the finding status", () => {
    const { onChange } = renderFilters();
    fireEvent.click(screen.getByRole("switch", { name: "Has findings" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, hasFindings: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Finding status" }), { target: { value: "open" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, findingStatus: "open" });
  });

  it("severity chips run worst first, show counts and toggle", () => {
    const { onChange } = renderFilters();
    const chips = screen.getAllByRole("button", { pressed: false }).filter((b) => b.dataset.level);
    expect(chips.map((c) => c.dataset.level)).toEqual(["4", "3", "2", "1"]);
    expect(chips[1]).toHaveTextContent("Major2");
    fireEvent.click(chips[1]);
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, severities: [3] });
  });

  it("while a severity filter is on, unselected chips show no count", () => {
    renderFilters({ ...DEFAULT_BROWSER_FILTERS, severities: [4] }, [4]);
    const major = screen.getAllByRole("button").find((b) => b.dataset.level === "3")!;
    expect(major).toHaveTextContent(/^Major$/);
  });

  it("More holds types, suggestions, reviewed, unlabeled, search and sort", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { onChange } = renderFilters();
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    fireEvent.click(await screen.findByRole("switch", { name: "Has suggestions" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, hasSuggestions: true });
    fireEvent.click(screen.getByRole("radio", { name: "Not reviewed" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, reviewed: "no" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "worst_severity" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, sort: "worst_severity" });
    fireEvent.click(screen.getByRole("button", { name: "Sort descending" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, order: "desc" });
    const calls = onChange.mock.calls.length;
    fireEvent.change(screen.getByRole("searchbox", { name: "Search file names" }), {
      target: { value: "0031" },
    });
    expect(onChange.mock.calls.length).toBe(calls);
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_COMMIT_MS + 10);
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_BROWSER_FILTERS, search: "0031" });
  });

  it("sort-direction icon points up for asc and down for desc (Ruling 7)", async () => {
    renderFilters();
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    const ascButton = await screen.findByRole("button", { name: "Sort descending" });
    expect(ascButton.querySelector("svg")).toHaveAttribute("data-icon", "arrow-left");
    let classes = ascButton.className.split(/\s+/);
    expect(classes).toContain("rotate-90");
    expect(classes).not.toContain("-rotate-90");
    cleanup();

    renderFilters({ ...DEFAULT_BROWSER_FILTERS, order: "desc" });
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    const descButton = await screen.findByRole("button", { name: "Sort ascending" });
    expect(descButton.querySelector("svg")).toHaveAttribute("data-icon", "arrow-right");
    classes = descButton.className.split(/\s+/);
    expect(classes).toContain("rotate-90");
    expect(classes).not.toContain("-rotate-90");
  });

  describe("search", () => {
    /** A parent that holds the filters, as the browser does. */
    function renderHosted(initial: BrowserFilterState = DEFAULT_BROWSER_FILTERS) {
      const { api } = fakeClient([
        { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
        { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
      ]);
      const seen: { value: BrowserFilterState; set: (f: BrowserFilterState) => void } = {
        value: initial,
        set: () => {},
      };
      function Host() {
        const [value, setValue] = useState(initial);
        seen.value = value;
        seen.set = setValue;
        return (
          <BrowserFilters
            projectId={PROJECT_ID}
            value={value}
            onChange={setValue}
            index={{ sev: [], total: 0 }}
          />
        );
      }
      renderWithProviders(<Host />, { api });
      fireEvent.click(screen.getByRole("button", { name: /More/ }));
      return seen;
    }

    it("a switch flipped while the search is pending is kept when the search commits", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const seen = renderHosted();
      fireEvent.change(await screen.findByRole("searchbox", { name: "Search file names" }), {
        target: { value: "0031" },
      });
      fireEvent.click(screen.getByRole("switch", { name: "Has findings" }));
      expect(seen.value.hasFindings).toBe(true);
      await act(async () => {
        vi.advanceTimersByTime(SEARCH_COMMIT_MS + 10);
      });
      expect(seen.value).toEqual({ ...DEFAULT_BROWSER_FILTERS, hasFindings: true, search: "0031" });
    });

    it("follows a search set from outside, and that change wins over a pending commit", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const seen = renderHosted({ ...DEFAULT_BROWSER_FILTERS, search: "DJI" });
      const box = await screen.findByRole("searchbox", { name: "Search file names" });
      expect(box).toHaveValue("DJI");
      act(() => seen.set({ ...seen.value, search: "0042" }));
      expect(box).toHaveValue("0042");
      fireEvent.change(box, { target: { value: "0042x" } });
      act(() => seen.set(DEFAULT_BROWSER_FILTERS));
      expect(box).toHaveValue("");
      await act(async () => {
        vi.advanceTimersByTime(SEARCH_COMMIT_MS + 10);
      });
      expect(seen.value.search).toBe("");
    });
  });
});
