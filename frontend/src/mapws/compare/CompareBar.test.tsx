import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useToastStore } from "@/ui";
import { makeStores, renderInWorkspace } from "../test/harness";
import { survey } from "../test/fixtures";
import { AUG, OCT, SEP } from "../test/rasterFixtures";
import { CompareBar } from "./CompareBar";

const TWO = [survey(AUG), survey(SEP), survey(OCT, { planned: true })];

function setup(surveys = TWO) {
  const stores = makeStores({ surveys });
  renderInWorkspace(<CompareBar />, {
    stores,
  });
  return stores.workspace;
}

describe("CompareBar (M §5 Compare)", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("disables compare modes with one survey and says why (M §14)", async () => {
    setup([survey(SEP)]);
    expect(screen.getByRole("radio", { name: "Swipe" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Single" })).toBeChecked();
    await userEvent.hover(screen.getByRole("radiogroup", { name: "Compare mode" }));
    expect(await screen.findByText("One survey so far")).toBeInTheDocument();
  });

  it("says there are no surveys yet and offers no date chip with none", async () => {
    setup([]);
    expect(screen.getByRole("radio", { name: "Swipe" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Survey/ })).toBeNull();
    await userEvent.hover(screen.getByRole("radiogroup", { name: "Compare mode" }));
    expect(await screen.findByText("No surveys yet")).toBeInTheDocument();
    expect(screen.queryByText("One survey so far")).toBeNull();
  });

  it("switches modes through W1's store", async () => {
    const ws = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Side-by-side" }));
    expect(ws.getState()).toMatchObject({ mode: "side", l: AUG, r: SEP });
  });

  it("Single shows one Survey chip; compare modes show Left and Right", () => {
    const ws = setup();
    expect(screen.getByRole("button", { name: "Survey: 14 Sep 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Left/ })).toBeNull();
    act(() => ws.getState().setMode("swipe"));
    expect(screen.getByRole("button", { name: "Left: 14 Aug 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Right: 14 Sep 2026" })).toBeInTheDocument();
  });

  it("offers flown dates only and refuses a Left pick with no later survey (W2-2)", async () => {
    const ws = setup();
    act(() => ws.getState().setMode("swipe"));
    await userEvent.click(screen.getByRole("button", { name: "Left: 14 Aug 2026" }));
    expect(screen.queryByRole("menuitem", { name: /14 Oct 2026/ })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: /14 Sep 2026/ }));
    expect(ws.getState()).toMatchObject({ l: AUG, r: SEP });
    expect(useToastStore.getState().toasts[0].text).toBe("No later survey to compare with");
  });

  it("shows the blend slider in Blend and writes the blend", async () => {
    const ws = setup();
    act(() => ws.getState().setMode("blend"));
    const slider = screen.getByRole("slider", { name: "Blend" });
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(ws.getState().blend).toBe(51);
  });
});
