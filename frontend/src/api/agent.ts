import type { ApiClient, components } from "@contract/client";
import { unwrap } from "./errors";
export type AgentPlan = components["schemas"]["AgentPlan"];
export type AgentMessage = components["schemas"]["AgentMessage"];
export type AgentChatRequest = components["schemas"]["AgentChatRequest"];

/** Conversation context is bounded independently of the visible transcript. */
export function chatWithAgent(api: ApiClient, body: AgentChatRequest) {
  return unwrap(
    api.POST("/api/v1/agent/chat", {
      body: {
        ...body,
        messages: body.messages.slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })),
      },
    }),
  );
}
