import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApi, ToolPointer } from "./bridge";
import type { SmartPolygon } from "./sam/useSmartPolygon";
import { setSamHandle } from "./samHandle";
import { SMART_TOOL_DEF } from "./smartTool";

const pointer = (o: Partial<ToolPointer>): ToolPointer => ({
  image: { x: 10, y: 20 },
  screen: { x: 1, y: 2 },
  shift: false,
  alt: false,
  button: 0,
  ...o,
});
const toolApi = {} as ToolApi;

afterEach(() => setSamHandle(null));

describe("SMART_TOOL_DEF.onDown (T10)", () => {
  it("left click adds a positive point, Shift+click a negative one, other buttons nothing", () => {
    const click = vi.fn();
    setSamHandle({ click } as unknown as SmartPolygon);
    SMART_TOOL_DEF.onDown?.(pointer({}), toolApi);
    expect(click).toHaveBeenLastCalledWith({ x: 10, y: 20 }, true);
    SMART_TOOL_DEF.onDown?.(pointer({ shift: true }), toolApi);
    expect(click).toHaveBeenLastCalledWith({ x: 10, y: 20 }, false);
    SMART_TOOL_DEF.onDown?.(pointer({ button: 2 }), toolApi);
    SMART_TOOL_DEF.onDown?.(pointer({ button: 1 }), toolApi);
    expect(click).toHaveBeenCalledTimes(2);
  });
});
