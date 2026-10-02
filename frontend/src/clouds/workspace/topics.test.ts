import { expect, it } from "vitest";
import { PALETTE } from "./tools";
import { CLOUD_TOPICS, TOPIC_OF_TOOL } from "./topics";

it("every cloud tool has exactly one home", () => {
  const ids = PALETTE.flat()
    .map((e) => e.id)
    .sort();
  expect(Object.keys(TOPIC_OF_TOOL).sort()).toEqual(ids);
  for (const t of Object.values(TOPIC_OF_TOOL)) expect([...CLOUD_TOPICS, "nav"]).toContain(t);
  expect(TOPIC_OF_TOOL.pin).toBe("findings");
  expect(TOPIC_OF_TOOL.section).toBe("measure");
  expect(TOPIC_OF_TOOL.clip).toBe("clip");
  expect(TOPIC_OF_TOOL.photo).toBe("photos");
});
