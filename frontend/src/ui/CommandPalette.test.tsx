import { act, configure, getConfig, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, SEARCH_DEBOUNCE_MS, type Command } from "./CommandPalette";

const cmd = (id: string, title: string, run: () => void = () => {}): Command => ({ id, title, run });

afterEach(() => vi.useRealTimers());

// @testing-library/react's default asyncWrapper settles with a Jest-only check
// (`jest.advanceTimersByTime`, guarded by `typeof jest`); under Vitest's fake timers that guard is
// always true, so the internal 0 ms setTimeout it awaits is registered but never advanced and every
// userEvent call hangs. Skip that Jest-specific flush while fake timers are active; the SEARCH_DEBOUNCE_MS
// assertions below drive the clock themselves via `tick()`.
const defaultAsyncWrapper = getConfig().asyncWrapper;

function fakeTimers() {
  configure({ asyncWrapper: async (cb) => cb() });
  vi.useFakeTimers();
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

afterEach(() => configure({ asyncWrapper: defaultAsyncWrapper }));

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

describe("CommandPalette", () => {
  it("filters the static commands and runs the active one on Enter, after closing", async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        groups={[{ label: "Go to", items: [cmd("projects", "Projects"), cmd("models", "Models", run)] }]}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "mod");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("moves across groups with ↓, closes on Esc, and says when nothing matches", async () => {
    const onClose = vi.fn();
    const run = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        groups={[
          { label: "Go to", items: [cmd("projects", "Projects")] },
          { label: "Actions", items: [cmd("new", "New project", run)] },
        ]}
      />,
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "New project" })).toHaveAttribute("aria-selected", "true");
    await userEvent.type(screen.getByRole("combobox", { name: "Command" }), "zzz");
    expect(screen.getByText("No matches")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("asks an async source once, 120 ms after the last keystroke, from 2 characters", async () => {
    const user = fakeTimers();
    const search = vi.fn(async () => [cmd("f1", "F-0001 Crack")]);
    render(
      <CommandPalette
        open
        onClose={() => {}}
        groups={[]}
        sources={[{ id: "findings", label: "Findings", search }]}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command" });
    await user.type(input, "c");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(search).not.toHaveBeenCalled();
    await user.type(input, "ra");
    await tick(SEARCH_DEBOUNCE_MS - 1);
    expect(search).not.toHaveBeenCalled();
    await tick(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("cra", expect.any(AbortSignal));
    expect(screen.getByRole("option", { name: /F-0001/ })).toBeInTheDocument();
  });

  it("never shows an older query's answer over a newer one", async () => {
    const user = fakeTimers();
    const pending: Record<string, (items: Command[]) => void> = {};
    const search = vi.fn((q: string) => new Promise<Command[]>((resolve) => (pending[q] = resolve)));
    render(
      <CommandPalette
        open
        onClose={() => {}}
        groups={[]}
        sources={[{ id: "findings", label: "Findings", search }]}
      />,
    );
    const input = screen.getByRole("combobox", { name: "Command" });
    await user.type(input, "cr");
    await tick(SEARCH_DEBOUNCE_MS);
    await user.type(input, "a");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending["cra"]([cmd("new", "F-0002 Crack")]);
      pending["cr"]([cmd("old", "F-0001 Crack")]);
    });
    expect(screen.getByRole("option", { name: /F-0002/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /F-0001/ })).toBeNull();
  });

  it("keeps a pending search when its parent re-renders with a new sources array", async () => {
    const user = fakeTimers();
    let finish: (items: Command[]) => void = () => {};
    const search = vi.fn(() => new Promise<Command[]>((resolve) => (finish = resolve)));
    function Host({ tick: n }: { tick: number }) {
      return (
        <CommandPalette
          open
          onClose={() => {}}
          groups={[{ label: "Go to", items: [cmd(`t${n}`, `Tick ${n}`)] }]}
          sources={[{ id: "findings", label: "Findings", search }]}
        />
      );
    }
    const { rerender } = render(<Host tick={1} />);
    await user.type(screen.getByRole("combobox", { name: "Command" }), "crack");
    await tick(SEARCH_DEBOUNCE_MS);
    rerender(<Host tick={2} />);
    await act(async () => finish([cmd("f3", "F-0003 Crack")]));
    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("option", { name: /F-0003/ })).toBeInTheDocument();
  });

  it("reports a failed source and keeps the static commands usable", async () => {
    const user = fakeTimers();
    const search = vi.fn(() => Promise.reject(new Error("offline")));
    render(
      <CommandPalette
        open
        onClose={() => {}}
        groups={[{ label: "Go to", items: [cmd("catalogue", "Catalogue")] }]}
        sources={[{ id: "findings", label: "Findings", search }]}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Command" }), "ca");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(screen.getByText("Couldn't search findings")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Catalogue" })).toBeInTheDocument();
  });

  it("treats a source that throws synchronously as failed and still asks the others", async () => {
    const user = fakeTimers();
    const broken = vi.fn(() => {
      throw new Error("bad index");
    });
    const images = vi.fn(async () => [cmd("img-1", "Castor yard 12")]);
    render(
      <CommandPalette
        open
        onClose={() => {}}
        groups={[]}
        sources={[
          { id: "findings", label: "Findings", search: broken },
          { id: "images", label: "Images", search: images },
        ]}
      />,
    );
    await user.type(screen.getByRole("combobox", { name: "Command" }), "ca");
    await tick(SEARCH_DEBOUNCE_MS);
    expect(images).toHaveBeenCalledTimes(1);
    const note = screen.getByText("Couldn't search findings");
    // An informative note needs 4.5:1: text-muted, not the 3:1 text-dim.
    expect(note.className).toMatch(/(^| )text-muted( |$)/);
    expect(note.className).not.toMatch(/(^| )text-dim( |$)/);
    expect(screen.getByRole("option", { name: "Castor yard 12" })).toBeInTheDocument();
  });

  it("returns focus to the opener", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Search</button>
          <CommandPalette open={open} onClose={() => setOpen(false)} groups={[]} />
        </>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toHaveAttribute("data-glass", "float");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
  });
});
