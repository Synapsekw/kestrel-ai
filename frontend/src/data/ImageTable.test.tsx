import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { exampleImage, exampleImage2 } from "@/test/fixtures";
import { ImageTable } from "./ImageTable";
import { DATA_COLUMNS } from "./listModel";

describe("ImageTable", () => {
  it("renders columns and rows, sorts on header click, selects and opens", () => {
    const onSort = vi.fn();
    const onRowClick = vi.fn();
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <ImageTable
        items={[exampleImage, exampleImage2]}
        columns={DATA_COLUMNS}
        rowContext={{ sourceNames: {} }}
        sort={{ key: "path", order: "asc" }}
        onSort={onSort}
        selected={new Set([exampleImage2.id])}
        focusIndex={0}
        onRowClick={onRowClick}
        onOpen={onOpen}
        onToggle={onToggle}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["File ▲", "Source", "Group", "Labeled", "Boxes", "Pending", "Captured"]),
    );
    fireEvent.click(screen.getByRole("columnheader", { name: "Boxes" }));
    expect(onSort).toHaveBeenCalledWith("box_count");

    const rows = screen.getAllByRole("row").filter((r) => r.getAttribute("aria-selected") !== null);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("IX-12-02491_0031_0002.jpg")).toBeInTheDocument();

    fireEvent.click(rows[0], { shiftKey: true });
    expect(onRowClick).toHaveBeenCalledWith(exampleImage.id, 0, { shift: true, ctrl: false });
    fireEvent.doubleClick(rows[1]);
    expect(onOpen).toHaveBeenCalledWith(exampleImage2.id);
    fireEvent.click(screen.getByLabelText("Select IX-12-02491_0031_0001.jpg"));
    expect(onToggle).toHaveBeenCalledWith(exampleImage.id);
  });
});
