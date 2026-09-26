import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { Command } from "@/ui";
import { collectCommands, useCommandRegistry, useCommands, type CommandGroup } from "./commands";

function Registers({ commands, group }: { commands: Command[]; group?: CommandGroup }) {
  useCommands(commands, group);
  return null;
}

const cmd = (id: string, title = id): Command => ({ id, title, run: vi.fn() });

describe("the command registry", () => {
  beforeEach(() => useCommandRegistry.setState({ entries: [] }));

  it("adds a screen's commands while it is mounted and removes them after", () => {
    const view = render(<Registers commands={[cmd("tool:box", "Box tool")]} />);
    const actions = () => collectCommands(useCommandRegistry.getState().entries, "Actions");
    expect(actions().map((c) => c.title)).toEqual(["Box tool"]);
    view.unmount();
    expect(actions()).toEqual([]);
  });

  it("keeps groups apart", () => {
    render(
      <>
        <Registers commands={[cmd("a")]} group="Go to" />
        <Registers commands={[cmd("b")]} />
      </>,
    );
    const { entries } = useCommandRegistry.getState();
    expect(collectCommands(entries, "Go to").map((c) => c.id)).toEqual(["a"]);
    expect(collectCommands(entries, "Actions").map((c) => c.id)).toEqual(["b"]);
  });

  it("lets a later registration of the same id replace the earlier one", () => {
    render(
      <>
        <Registers commands={[cmd("x", "Old")]} />
        <Registers commands={[cmd("x", "New")]} />
      </>,
    );
    expect(collectCommands(useCommandRegistry.getState().entries, "Actions").map((c) => c.title)).toEqual([
      "New",
    ]);
  });

  it("follows a screen whose commands change", () => {
    const view = render(<Registers commands={[cmd("a")]} />);
    view.rerender(<Registers commands={[cmd("b")]} />);
    expect(collectCommands(useCommandRegistry.getState().entries, "Actions").map((c) => c.id)).toEqual(["b"]);
  });
});
