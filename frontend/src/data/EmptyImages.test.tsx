import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmptyImages } from "./EmptyImages";

describe("EmptyImages", () => {
  it("offers the import on this screen when the project has no images at all", () => {
    const onImport = vi.fn();
    render(<EmptyImages filtered={false} onImport={onImport} onClearFilters={() => {}} />);
    expect(screen.getByText("This project has no images yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Projects screen/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import a folder of images" }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("offers to clear the filters when they hide every image", () => {
    const onClear = vi.fn();
    render(<EmptyImages filtered onImport={() => {}} onClearFilters={onClear} />);
    expect(screen.getByText("No images match the filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
