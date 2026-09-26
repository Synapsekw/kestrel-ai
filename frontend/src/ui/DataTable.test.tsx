import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, ROW_HEIGHT, type Column, type Sort } from "./DataTable";

interface Row {
  id: string;
  name: string;
}

const make = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));
const COLUMNS: Column<Row>[] = [{ key: "name", header: "Name", render: (r) => r.name, sortable: true }];

/** jsdom has no layout; a writable scrollTop stands in for scrolling the grid. */
function scrollTo(grid: HTMLElement, top: number) {
  Object.defineProperty(grid, "scrollTop", { configurable: true, writable: true, value: top });
  fireEvent.scroll(grid);
}

describe("DataTable", () => {
  it("renders a fixed window of rows however many there are", () => {
    render(<DataTable label="Findings" columns={COLUMNS} rows={make(10_000)} rowKey={(r) => r.id} />);
    const grid = screen.getByRole("grid", { name: "Findings" });
    // header + 18 rows: the 600 px jsdom fallback / 44 px = 14 visible, plus 4 overscan
    expect(within(grid).getAllByRole("row")).toHaveLength(19);
    expect(grid).toHaveAttribute("aria-rowcount", "10001");
  });

  it("moves the window as it scrolls", () => {
    render(<DataTable label="Findings" columns={COLUMNS} rows={make(10_000)} rowKey={(r) => r.id} />);
    const grid = screen.getByRole("grid", { name: "Findings" });
    scrollTo(grid, ROW_HEIGHT * 1000);
    expect(screen.getByText("Row 1000")).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).toBeNull();
    expect(within(grid).getAllByRole("row").length).toBeLessThanOrEqual(23);
  });

  it("walks rows with ↓ ↑ J K, opens with Enter, and keeps the keys from the workspace", async () => {
    const onOpen = vi.fn();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    const rows = make(50);
    render(<DataTable label="Findings" columns={COLUMNS} rows={rows} rowKey={(r) => r.id} onOpen={onOpen} />);
    screen.getByRole("grid", { name: "Findings" }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}jk{Enter}");
    expect(onOpen).toHaveBeenCalledWith(rows[2]);
    expect(onWindow).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindow);
  });

  it("selects one row by click and a range with shift-click", async () => {
    function Host() {
      const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
      return (
        <>
          <DataTable
            label="Findings"
            columns={COLUMNS}
            rows={make(20)}
            rowKey={(r) => r.id}
            selected={selected}
            onSelectionChange={setSelected}
          />
          <p data-testid="picked">{[...selected].sort().join(",")}</p>
        </>
      );
    }
    render(<Host />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("checkbox", { name: "Select row 5" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByTestId("picked")).toHaveTextContent("r1,r2,r3,r4");
    await user.click(screen.getByRole("checkbox", { name: "Select all loaded rows" }));
    expect(screen.getByTestId("picked").textContent!.split(",")).toHaveLength(20);
  });

  it("asks for the next page once per page", () => {
    const onEndReached = vi.fn();
    const { rerender } = render(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={make(30)}
        rowKey={(r) => r.id}
        onEndReached={onEndReached}
      />,
    );
    const grid = screen.getByRole("grid", { name: "Findings" });
    expect(onEndReached).not.toHaveBeenCalled();
    scrollTo(grid, 30 * ROW_HEIGHT);
    scrollTo(grid, 30 * ROW_HEIGHT + 10);
    expect(onEndReached).toHaveBeenCalledTimes(1);
    rerender(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={make(60)}
        rowKey={(r) => r.id}
        onEndReached={onEndReached}
      />,
    );
    scrollTo(grid, 60 * ROW_HEIGHT);
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it("sorts from the header", async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={make(3)}
        rowKey={(r) => r.id}
        sort={null}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", dir: "asc" } satisfies Sort);
    rerender(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={make(3)}
        rowKey={(r) => r.id}
        sort={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", dir: "desc" });
  });

  it("shows skeleton rows while the first page loads, then the empty state", () => {
    const { rerender } = render(
      <DataTable label="Findings" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />,
    );
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    rerender(
      <DataTable
        label="Findings"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<p>No findings yet</p>}
      />,
    );
    expect(screen.getByText("No findings yet")).toBeInTheDocument();
  });
});
