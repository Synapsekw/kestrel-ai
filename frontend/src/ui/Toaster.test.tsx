import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./Toaster";
import { toast, useToastStore } from "./toastStore";

describe("Toaster", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("shows a toast, caps the list at three and dismisses on click", async () => {
    render(<Toaster />);
    act(() => {
      toast("ok", "Model v2 registered");
    });
    expect(screen.getByText("Model v2 registered")).toBeInTheDocument();
    act(() => {
      toast("ok", "two");
      toast("ok", "three");
      toast("ok", "four");
    });
    expect(screen.queryByText("Model v2 registered")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(3);
    await userEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.queryByText("two")).not.toBeInTheDocument();
  });

  it("runs the action and closes, and failures are alerts", async () => {
    const onClick = vi.fn();
    render(<Toaster />);
    act(() => {
      toast("danger", "Training failed", { label: "Show log", onClick });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Training failed");
    await userEvent.click(screen.getByRole("button", { name: "Show log" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes away by itself after its time", () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => {
        toast("info", "Import started");
      });
      expect(screen.getByText("Import started")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(6100);
      });
      expect(screen.queryByText("Import started")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
