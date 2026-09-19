import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleDataset } from "@/test/fixtures";
import { formatLocalDate } from "@/models/modelLabels";
import { DatasetList } from "./DatasetList";

describe("DatasetList", () => {
  it("renders one row per dataset with image counts, split and created date", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    const row = screen.getByText("v1").closest("tr");
    expect(row).toHaveTextContent("30");
    expect(row).toHaveTextContent("24 / 6");
    expect(row).toHaveTextContent("by group");
    expect(row).toHaveTextContent(formatLocalDate(exampleDataset.created_at));
  });

  it("selects a row by click", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("v1"));
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });

  it("selects the focused row on Enter and marks the selected row", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={exampleDataset.id} onSelect={onSelect} />);
    const row = screen.getByText("v1").closest("tr")!;
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("tabIndex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });
});
