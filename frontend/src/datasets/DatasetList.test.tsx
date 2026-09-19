import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleDataset, runningJob } from "@/test/fixtures";
import { formatLocalDate } from "@/models/modelLabels";
import { useJobsStore } from "@/store/jobs";
import { DatasetList } from "./DatasetList";

const rowOf = (text: string) => screen.getByText(text).closest('[role="row"]') as HTMLElement;

describe("DatasetList", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("renders one row per dataset with image counts, split and created date", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    const row = rowOf("v1");
    expect(row).toHaveTextContent("30 images");
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
    const row = rowOf("v1");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveAttribute("tabIndex", "0");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });

  it("marks a dataset whose job still runs as writing, and one whose job failed as incomplete", () => {
    const jobId = exampleDataset.job_id!;
    useJobsStore.setState({ jobs: { [jobId]: { ...runningJob, id: jobId, type: "dataset" } } });
    const { rerender } = render(
      <DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(rowOf("v1")).toHaveTextContent("Writing");

    useJobsStore.setState({
      jobs: { [jobId]: { ...runningJob, id: jobId, type: "dataset", state: "failed" } },
    });
    rerender(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />);
    expect(rowOf("v1")).toHaveTextContent("Incomplete");
    expect(rowOf("v1")).not.toHaveTextContent("Writing");
  });

  it("shows no state pill for a finished dataset", () => {
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />);
    expect(rowOf("v1")).not.toHaveTextContent(/Writing|Incomplete/);
  });
});
