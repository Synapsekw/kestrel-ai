import { describe, it, expect } from "vitest";
import type { AgentTurn } from "@contract/client";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { cancelTurn, clearConversation, decideApproval, fetchConversation, startTurn } from "./projectAgent";

const turn: AgentTurn = {
  id: "turn-1",
  state: "running",
  provider: "anthropic",
  model_name: "claude-opus-5",
  error: null,
  tool_calls: 0,
  created_at: "2026-09-22T10:00:00Z",
  finished_at: null,
};
const base = `/api/v1/projects/${PROJECT_ID}/agent`;

describe("project agent api", () => {
  it("fetches the conversation", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/agent$/, body: { items: [], turn: null } },
    ]);
    await expect(fetchConversation(api, PROJECT_ID)).resolves.toEqual({ items: [], turn: null });
    expect(requests[0]).toMatchObject({ method: "GET", url: base });
  });

  it("starts a turn with the provider and message", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/agent\/turns$/, status: 202, body: turn },
    ]);
    await expect(startTurn(api, PROJECT_ID, { provider: "anthropic", message: "Hi" })).resolves.toEqual(turn);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `${base}/turns`,
      body: { provider: "anthropic", message: "Hi" },
    });
  });

  it("cancels a turn", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/cancel$/, body: { ...turn, state: "cancelled" } },
    ]);
    const r = await cancelTurn(api, PROJECT_ID, "turn-1");
    expect(r.state).toBe("cancelled");
    expect(requests[0]).toMatchObject({ method: "POST", url: `${base}/turns/turn-1/cancel` });
  });

  it("sends an approval decision", async () => {
    const { api, requests } = fakeClient([{ method: "POST", path: /\/approval$/, body: turn }]);
    await decideApproval(api, PROJECT_ID, "turn-1", false);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: `${base}/turns/turn-1/approval`,
      body: { approve: false },
    });
  });

  it("clears the conversation", async () => {
    const { api, requests } = fakeClient([{ method: "DELETE", path: /\/agent$/, status: 204 }]);
    await expect(clearConversation(api, PROJECT_ID)).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({ method: "DELETE", url: base });
  });

  it("throws the envelope message on a conflict", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/agent\/turns$/,
        status: 409,
        body: { error: { code: "agent_busy", message: "The agent is busy", details: {} } },
      },
    ]);
    await expect(startTurn(api, PROJECT_ID, { provider: "openai", message: "Hi" })).rejects.toMatchObject({
      code: "agent_busy",
      message: "The agent is busy",
    });
  });
});
