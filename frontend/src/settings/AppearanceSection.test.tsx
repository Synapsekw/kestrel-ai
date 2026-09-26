import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { readEffectsChoice } from "@/app/effects";
import { fakeClient } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { readMotionChoice } from "@/ui/motion";
import { AppearanceSection } from "./AppearanceSection";

function renderSection(name: string | null = null) {
  const client = fakeClient([
    { method: "GET", path: /\/settings\/operator$/, body: { operator_name: name } },
    { method: "PUT", path: /\/settings\/operator$/, body: (r) => r.body as object },
  ]);
  renderWithProviders(<AppearanceSection />, { api: client.api });
  return client;
}

describe("AppearanceSection (F §4.3)", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches visual effects and remembers the choice", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: "Auto" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Reduced" }));
    expect(readEffectsChoice()).toBe("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(screen.getByRole("radio", { name: "Reduced" })).toBeChecked();
  });

  it("turns on reduced motion", () => {
    renderSection();
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    expect(readMotionChoice()).toBe("reduce");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });

  it("shows the stored name and saves a new one through the backend when the field loses focus", async () => {
    const { requests } = renderSection("Ana");
    const input = screen.getByLabelText("Your name");
    await waitFor(() => expect(input).toHaveValue("Ana"));
    expect(input).toHaveAttribute("placeholder", "Operator");
    fireEvent.change(input, { target: { value: "Dana" } });
    fireEvent.blur(input);
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({ operator_name: "Dana" });
  });
});
