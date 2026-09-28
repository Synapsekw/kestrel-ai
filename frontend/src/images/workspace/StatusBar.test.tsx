import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusBar } from "./StatusBar";

const hints = [{ keys: ["Enter"], help: "close" }];

describe("StatusBar", () => {
  it("shows position, reviewed and Saved under E's hooks", () => {
    render(
      <StatusBar hints={hints} position={212} total={312} reviewed={198} save="saved" onRetry={vi.fn()} />,
    );
    const bar = screen.getByTestId("images-status-bar");
    expect(bar).toHaveTextContent(/Image\s*212\s*\/\s*312/);
    expect(bar).toHaveTextContent("Reviewed 198");
    expect(screen.getByTestId("save-state")).toHaveTextContent("Saved");
  });
  it("offers Retry after a failed save", async () => {
    const onRetry = vi.fn();
    render(
      <StatusBar hints={hints} position={null} total={0} reviewed={0} save="failed" onRetry={onRetry} />,
    );
    expect(screen.getByTestId("save-state")).toHaveTextContent("Save failed");
    expect(screen.getByTestId("images-status-bar")).toHaveTextContent(/Image\s*—\s*\/\s*0/);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
