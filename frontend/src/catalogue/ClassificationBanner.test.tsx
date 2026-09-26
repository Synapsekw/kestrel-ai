import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ClassificationBanner } from "./ClassificationBanner";

function renderBanner(count: number, filtered = true, status = 204) {
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/catalogue\/classification\/done$/,
      status,
      body: status === 204 ? undefined : errorBody("catalogue_unavailable", "locked"),
    },
  ]);
  const props = { onShowAll: vi.fn(), onShowMigrated: vi.fn(), onDone: vi.fn() };
  renderWithProviders(<ClassificationBanner count={count} filtered={filtered} {...props} />, { api });
  return { requests, ...props };
}

describe("ClassificationBanner", () => {
  it("says how many types came from existing projects, in the spec's words", () => {
    renderBanner(12);
    expect(
      screen.getByText("12 types came from your existing projects. Mark which are defects."),
    ).toBeInTheDocument();
  });

  it("uses the singular for one type", () => {
    renderBanner(1);
    expect(
      screen.getByText("1 type came from your existing projects. Mark which are defects."),
    ).toBeInTheDocument();
  });

  it("switches between the migrated view and all types", () => {
    const filtered = renderBanner(2, true);
    fireEvent.click(screen.getByRole("button", { name: "Show all types" }));
    expect(filtered.onShowAll).toHaveBeenCalled();
  });

  it("Done clears the flag on the server and tells the screen", async () => {
    const { requests, onDone } = renderBanner(2);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(requests[0].url).toBe("/api/v1/catalogue/classification/done");
  });

  it("keeps the banner and explains when Done fails", async () => {
    const { onDone } = renderBanner(2, true, 503);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("locked");
    expect(onDone).not.toHaveBeenCalled();
  });
});
