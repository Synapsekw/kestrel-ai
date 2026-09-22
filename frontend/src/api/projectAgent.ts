import type { AgentConversation, AgentTurn, ApiClient, ProviderName } from "@contract/client";
import { unwrap } from "./errors";

/** The last 200 items, oldest first, and the latest turn. */
export function fetchConversation(api: ApiClient, projectId: string): Promise<AgentConversation> {
  return unwrap(api.GET("/api/v1/projects/{projectId}/agent", { params: { path: { projectId } } }));
}

/** 202: the turn runs in the background and reports through `agent.changed`. */
export function startTurn(
  api: ApiClient,
  projectId: string,
  body: { provider: ProviderName; message: string },
): Promise<AgentTurn> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/agent/turns", {
      params: { path: { projectId } },
      body: { provider: body.provider, message: body.message },
    }),
  );
}

/** Jobs the turn already started keep running. */
export function cancelTurn(api: ApiClient, projectId: string, turnId: string): Promise<AgentTurn> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/agent/turns/{turnId}/cancel", {
      params: { path: { projectId, turnId } },
    }),
  );
}

export function decideApproval(
  api: ApiClient,
  projectId: string,
  turnId: string,
  approve: boolean,
): Promise<AgentTurn> {
  return unwrap(
    api.POST("/api/v1/projects/{projectId}/agent/turns/{turnId}/approval", {
      params: { path: { projectId, turnId } },
      body: { approve },
    }),
  );
}

/** 409 while a turn is running or awaiting approval. */
export async function clearConversation(api: ApiClient, projectId: string): Promise<void> {
  await unwrap<unknown>(
    api.DELETE("/api/v1/projects/{projectId}/agent", { params: { path: { projectId } } }),
  );
}
