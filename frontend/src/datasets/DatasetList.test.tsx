import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { exampleDataset, runningJob } from "@/test/fixtures";
import { useJobsStore } from "@/store/jobs";
import { formatLocalDate } from "@/library/modelLabels";
import { DatasetList } from "./DatasetList";

describe("DatasetList", () => {
  it("renders one row per dataset with image counts, split and created date", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: "Select dataset v1" }).closest("li");
    expect(row).toHaveTextContent("30 images");
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
    fireEvent.click(screen.getByText(/24 \/ 6/));
    expect(onSelect).toHaveBeenCalledWith(exampleDataset.id);
  });

  it("marks the selected row and leaves the focus on the name button (M9)", () => {
    const onSelect = vi.fn();
    render(<DatasetList datasets={[exampleDataset]} selectedId={exampleDataset.id} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: "Select dataset v1" }).closest("li")!;
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).not.toHaveAttribute("tabIndex");
  });

  it("marks a dataset whose job still runs as writing, and one whose job failed as incomplete", () => {
    const jobId = exampleDataset.job_id!;
    useJobsStore.setState({ jobs: { [jobId]: { ...runningJob, id: jobId, type: "dataset" } } });
    const row = () => screen.getByRole("button", { name: "Select dataset v1" }).closest("li")!;
    const { rerender } = render(
      <DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(row()).toHaveTextContent("Writing");
    useJobsStore.setState({
      jobs: { [jobId]: { ...runningJob, id: jobId, type: "dataset", state: "failed" } },
    });
    rerender(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />);
    expect(row()).toHaveTextContent("Incomplete");
    expect(row()).not.toHaveTextContent("Writing");
    useJobsStore.setState({ jobs: {} });
    rerender(<DatasetList datasets={[exampleDataset]} selectedId={null} onSelect={vi.fn()} />);
    expect(row()).not.toHaveTextContent(/Writing|Incomplete/);
  });
});
