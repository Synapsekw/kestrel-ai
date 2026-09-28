import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { TestApiProvider } from "@/test/render";
import { viewOut } from "@/test/cloudViewFixtures";
import { ReportViewCard } from "./ReportViewCard";
import { useViewStore } from "./viewStore";

const F1 = { kind: "finding" as const, id: "f1" };
const enqueue = vi.fn();

function show(subject: { kind: "finding" | "cloud_measurement"; id: string } = F1) {
  return render(
    <TestApiProvider api={{} as ApiClient}>
      <ReportViewCard subject={subject} />
    </TestApiProvider>,
  );
}

describe("ReportViewCard", () => {
  beforeEach(() => {
    enqueue.mockReset();
    const s = useViewStore.getState();
    s.reset("p1", "c1");
    s.setReady(true);
    s.setActions({ enqueue, captureMissing: vi.fn(), cancelMissing: vi.fn() });
  });

  it("shows a placeholder while the views load", () => {
    const { container } = show();
    expect(container.querySelector("[data-state='loading']")).not.toBeNull();
    expect(screen.queryByText("No report view")).toBeNull();
  });

  it("offers Capture when there is no view", () => {
    useViewStore.getState().setViews([]);
    show();
    expect(screen.getByText("No report view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect(enqueue).toHaveBeenCalledWith(F1, "missing");
  });

  it("shows the stored view with a cache-busting URL and refreshes on the current camera", () => {
    useViewStore.getState().setViews([viewOut({ sha256: "s1" })]);
    show();
    expect(screen.getByRole("img", { name: "Report view" })).toHaveAttribute(
      "src",
      "http://fake/api/v1/projects/p1/findings/f1/view3d?token=t&v=s1",
    );
    expect(screen.queryByText("stale")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh view" }));
    expect(enqueue).toHaveBeenCalledWith(F1, "refresh");
  });

  it("builds a measurement's URL under its cloud", () => {
    useViewStore
      .getState()
      .setViews([viewOut({ subject_kind: "cloud_measurement", subject_id: "m1", sha256: "s2" })]);
    show({ kind: "cloud_measurement", id: "m1" });
    expect(screen.getByRole("img", { name: "Report view" })).toHaveAttribute(
      "src",
      "http://fake/api/v1/projects/p1/pointclouds/c1/measurements/m1/view3d?token=t&v=s2",
    );
  });

  it("marks a stale view and an incomplete one", () => {
    useViewStore
      .getState()
      .setViews([viewOut({ stale: true, render: { ...viewOut().render, complete: false } })]);
    show();
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByText("saved before the view finished loading")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(enqueue).toHaveBeenCalledWith(F1, "refresh");
  });

  it("disables the action while a capture runs or without a viewer", () => {
    useViewStore.getState().setViews([viewOut()]);
    useViewStore.getState().setBusy("finding:f1", true);
    const { unmount } = show();
    expect(screen.getByText("Saving view…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh view" })).toBeDisabled();
    unmount();
    useViewStore.getState().setBusy("finding:f1", false);
    useViewStore.getState().setReady(false);
    show();
    expect(screen.getByRole("button", { name: "Refresh view" })).toBeDisabled();
  });

  it("falls back to No report view when the image cannot be read", () => {
    useViewStore.getState().setViews([viewOut()]);
    show();
    fireEvent.error(screen.getByRole("img", { name: "Report view" }));
    expect(screen.getByText("No report view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture" })).toBeInTheDocument();
  });
});
