import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ListReloadNotice } from "./ListReloadNotice";

describe("ListReloadNotice", () => {
  it("says the list could not be refreshed, why, and retries", () => {
    const onRetry = vi.fn();
    render(<ListReloadNotice error="The server did not answer." onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The model list could not be refreshed.");
    expect(alert).toHaveTextContent("The server did not answer.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
