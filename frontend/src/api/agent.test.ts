import { describe, it, expect } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { chatWithAgent } from "./agent";
describe("agent conversation boundary", () => {
  it("clips long assistant replies and retains the latest user in the last 12 messages", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/agent\/chat$/,
        body: { message: "Ready", plan: null, model_name: "configured-model" },
      },
    ]);
    await chatWithAgent(api, {
      provider: "openai",
      messages: [
        ...Array.from({ length: 20 }, (_, i) => ({
          role: "assistant" as const,
          content: `${i}:` + "a".repeat(3000),
        })),
        { role: "user", content: "Latest intent" },
      ],
    });
    const body = requests[0].body as { messages: { role: string; content: string }[] };
    expect(body.messages).toHaveLength(12);
    expect(body.messages[0].content).toHaveLength(2000);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "Latest intent" });
  });
});
