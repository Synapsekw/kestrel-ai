import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleDataset } from "@/test/fixtures";
import { formatLocalDate } from "@/models/modelLabels";
import { DatasetList } from "./DatasetList";

describe("DatasetList", () => {
  it("renders one row per dataset with image counts, split and created date", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: "Select dataset v1" }).closest("tr");
    expect(row).toHaveTextContent("30");
    expect(row).toHaveTextContent("24 / 6");
    expect(row).toHaveTextContent("by group");
    expect(row).toHaveTextContent(formatLocalDate(exampleDataset.created_at));
  });

  it("selects a dataset by clicking its name button, exactly once (not also via the row)", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Select dataset v1" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });

  it("selects a dataset by clicking anywhere on its row", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("24 / 6"));
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });

  it("marks the selected row and never adds a redundant role='row' (M9)", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={exampleDataset.id} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: "Select dataset v1" }).closest("tr")!;
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).not.toHaveAttribute("role", "row");
  });
});
