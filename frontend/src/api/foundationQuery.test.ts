import { describe, expect, it } from "vitest";
import { createApiClient } from "@contract/client";

/** The URL the typed client builds for a request (foundation unit C0; list filters repeat a key). */
async function urlOf(send: (api: ReturnType<typeof createApiClient>) => Promise<unknown>): Promise<URL> {
  let seen = "";
  const api = createApiClient({
    baseUrl: "http://fake",
    token: "t",
    fetch: async (input) => {
      seen = input instanceof Request ? input.url : String(input);
      return new Response(JSON.stringify({ items: [], next_cursor: null }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await send(api);
  return new URL(seen);
}

describe("foundation list filters through the typed client", () => {
  it("repeats each value of a findings filter, the form the backend reads", async () => {
    const url = await urlOf((api) =>
      api.GET("/api/v1/projects/{projectId}/findings", {
        params: {
          path: { projectId: "p1" },
          query: { status: ["open", "reviewed"], severity: ["none", "3"], anchor_kind: ["image"] },
        },
      }),
    );
    expect(url.pathname).toBe("/api/v1/projects/p1/findings");
    expect(url.searchParams.getAll("status")).toEqual(["open", "reviewed"]);
    expect(url.searchParams.getAll("severity")).toEqual(["none", "3"]);
    expect(url.searchParams.getAll("anchor_kind")).toEqual(["image"]);
  });

  it("repeats the job states and types of the app-wide jobs list", async () => {
    const url = await urlOf((api) =>
      api.GET("/api/v1/jobs", { params: { query: { state: ["running", "queued"], type: ["train"] } } }),
    );
    expect(url.searchParams.getAll("state")).toEqual(["running", "queued"]);
    expect(url.searchParams.getAll("type")).toEqual(["train"]);
  });
});
