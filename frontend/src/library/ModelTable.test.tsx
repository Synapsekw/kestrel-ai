import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { exampleModel, exampleTrainedModel, TRAINED_MODEL_ID } from "@/test/fixtures";
import { ModelTable } from "./ModelTable";

describe("ModelTable", () => {
  it("shows name, origin, task and class count per model, and selects on click", () => {
    const onSelect = vi.fn();
    render(
      <ModelTable models={[exampleTrainedModel, exampleModel]} selectedId={TRAINED_MODEL_ID} onSelect={onSelect} />,
    );
    const rows = within(screen.getByTestId("model-table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("ahmadia-v1-n");
    expect(rows[0]).toHaveTextContent("Trained");
    expect(rows[0]).toHaveTextContent("Boxes");
    expect(rows[0]).toHaveTextContent("2");
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[1]).toHaveTextContent("Starter");
    expect(rows[1]).toHaveTextContent("8");
    fireEvent.click(screen.getByRole("button", { name: "Select model yolo11m-coco" }));
    expect(onSelect).toHaveBeenCalledWith(exampleModel.id);
  });

  it("flags a model whose weights file is missing", () => {
    render(
      <ModelTable models={[{ ...exampleModel, state: "unavailable" }]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("File missing")).toBeInTheDocument();
  });
});
