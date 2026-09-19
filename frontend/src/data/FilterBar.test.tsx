import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FilterBar } from "./FilterBar";
import { DEFAULT_QUERY } from "./listModel";

describe("FilterBar", () => {
  it("debounces search and emits sort, filters and view changes", async () => {
    const onChange = vi.fn();
    const onView = vi.fn();
    render(
      <FilterBar
        query={DEFAULT_QUERY}
        onChange={onChange}
        view="grid"
        onView={onView}
        sourceNames={{ s1: "ahmadia" }}
        total={2}
        loaded={2}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search file name"), { target: { value: "0031" } });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        ...DEFAULT_QUERY,
        filters: { ...DEFAULT_QUERY.filters, search: "0031" },
      }),
    );

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "capture_time" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, sort: "capture_time", order: "asc" });
    fireEvent.click(screen.getByLabelText("Sort order"));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_QUERY, order: "desc" });

    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "s1" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_QUERY,
      filters: { ...DEFAULT_QUERY.filters, sourceId: "s1" },
    });
    fireEvent.change(screen.getByLabelText("Labeled"), { target: { value: "yes" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_QUERY,
      filters: { ...DEFAULT_QUERY.filters, labeled: "yes" },
    });
    fireEvent.change(screen.getByLabelText("Pending review"), { target: { value: "no" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_QUERY,
      filters: { ...DEFAULT_QUERY.filters, pending: "no" },
    });
    fireEvent.change(screen.getByLabelText("Min boxes"), { target: { value: "3" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_QUERY,
      filters: { ...DEFAULT_QUERY.filters, minBoxes: 3 },
    });

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(onView).toHaveBeenCalledWith("list");
    expect(screen.getByText("2 of 2 images")).toBeInTheDocument();
  });

  it("offers a visible select-all for the listed images", () => {
    const onSelectAll = vi.fn();
    const { rerender } = render(
      <FilterBar
        query={DEFAULT_QUERY}
        onChange={() => {}}
        view="grid"
        onView={() => {}}
        sourceNames={{}}
        total={40}
        loaded={40}
        onSelectAll={onSelectAll}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select all 40" }));
    expect(onSelectAll).toHaveBeenCalledOnce();
    rerender(
      <FilterBar
        query={DEFAULT_QUERY}
        onChange={() => {}}
        view="grid"
        onView={() => {}}
        sourceNames={{}}
        total={0}
        loaded={0}
        onSelectAll={onSelectAll}
      />,
    );
    expect(screen.queryByRole("button", { name: /Select all/ })).toBeNull();
  });
});
