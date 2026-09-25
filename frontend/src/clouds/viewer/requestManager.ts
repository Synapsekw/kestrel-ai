/**
 * potree-core's RequestManager (spec §7): the loader asks for `…/metadata.json` through `getUrl`,
 * then derives the other two files with `.replace("/metadata.json", …)`, so a `?token=` query
 * survives. A non-2xx answer throws the backend's own message, so the viewer can say why.
 */
export interface OctreeRequestManager {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  getUrl(url: string): Promise<string>;
}

export function withToken(url: string, token: string): string {
  const u = new URL(url);
  if (!u.searchParams.has("token")) u.searchParams.set("token", token);
  return u.toString();
}

/** The URL handed to `potree.loadPointCloud`: potree-core chooses its Potree 2 loader with
 * `url.endsWith("metadata.json")`, so any query (a token) is stripped here and added back by
 * `getUrl` on every request. */
export function metadataUrl(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  const bare = u.toString();
  if (!bare.endsWith("/metadata.json")) throw new Error(`not an octree metadata URL: ${bare}`);
  return bare;
}

async function failure(r: Response): Promise<Error> {
  try {
    const body = (await r.clone().json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string") return new Error(body.error.message);
  } catch {
    // not JSON: fall through to the status
  }
  return new Error(`the 3D view copy could not be loaded (HTTP ${r.status})`);
}

export function makeRequestManager(
  token: string,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (i, init) =>
    fetch(i, init),
): OctreeRequestManager {
  return {
    getUrl: async (url) => withToken(url, token),
    fetch: async (input, init) => {
      const r = await fetchImpl(input, init);
      if (!r.ok) throw await failure(r);
      return r;
    },
  };
}
