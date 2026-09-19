import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { exampleTrainedModel } from "@/test/fixtures";
import { ModelTable } from "./ModelTable";

describe("ModelTable", () => {
  it("names the dataset once loaded", () => {
    render(
      <ModelTable
        models={[exampleTrainedModel]}
        datasetNames={{ names: { [exampleTrainedModel.dataset_id!]: "v1" }, loaded: true }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("shows 'deleted dataset' once loaded and the id is missing (I4)", () => {
    render(
      <ModelTable
        models={[exampleTrainedModel]}
        datasetNames={{ names: {}, loaded: true }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("deleted dataset")).toBeInTheDocument();
  });

  it("falls back to the short id while loading or unavailable, never claiming deletion", () => {
    render(
      <ModelTable
        models={[exampleTrainedModel]}
        datasetNames={{ names: {}, loaded: false }}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("deleted dataset")).not.toBeInTheDocument();
    expect(screen.getByText(exampleTrainedModel.dataset_id!.slice(0, 8))).toBeInTheDocument();
  });
});
