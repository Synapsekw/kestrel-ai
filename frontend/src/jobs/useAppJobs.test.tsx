import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient } from "@/test/fixtures";
import { exampleAppJobs } from "@/test/appSectionFixtures";
import { TestApiProvider } from "@/test/render";
import { useAppJobs } from "./useAppJobs";

const wrapper =
  (api: ApiClient) =>
  ({ children }: { children: ReactNode }) => <TestApiProvider api={api}>{children}</TestApiProvider>;

describe("useAppJobs", () => {
  it("loads more pages on demand and stops on a repeated cursor", async () => {
    const [, done, failed] = exampleAppJobs;
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/api\/v1\/jobs$/,
        body: (r) =>
          r.url.includes("cursor=")
            ? { items: [{ ...failed, state: "succeeded" }], next_cursor: "string" }
            : { items: [done], next_cursor: "string" },
      },
    ]);
    const { result } = renderHook(() => useAppJobs("finished", null), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
    expect(requests.filter((r) => r.url.includes("cursor="))).toHaveLength(1);
  });
});
