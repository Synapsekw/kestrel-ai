import { describe, expect, it } from "vitest";
import "@/mapws/plugins";
import { MAP_TOOL_ACTIONS, toolRegistry, toolsOfTopic } from "./toolStore";
import { MAP_TOPICS } from "../topics/topicIds";

describe("every map tool has exactly one home", () => {
  const tools = toolRegistry.all();

  it("each registered tool names a known topic", () => {
    for (const t of tools) expect([...MAP_TOPICS, "nav"]).toContain(t.topic);
  });

  it("the topics together hold every tool once", () => {
    const placed = [...MAP_TOPICS, "nav" as const].flatMap((id) => toolsOfTopic(tools, id).map((t) => t.id));
    expect(placed.sort()).toEqual(Object.keys(MAP_TOOL_ACTIONS).sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("topic order follows `order`", () => {
    expect(toolsOfTopic(tools, "measure").map((t) => t.id)).toEqual([
      "distance",
      "area",
      "profile",
      "volume",
    ]);
    expect(toolsOfTopic(tools, "findings").map((t) => t.id)).toEqual([
      "finding-point",
      "finding-polygon",
      "zone",
    ]);
  });
});
