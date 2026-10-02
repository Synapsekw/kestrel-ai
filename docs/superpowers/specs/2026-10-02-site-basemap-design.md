# Site basemap under the Location pane

**Date:** 2026-10-02 · **Amends:** `2026-09-30-project-landing-design.md` §2 (non-goal "a basemap") and D8.

## 1. Problem

The Overview's Location pane draws the site outline, photo points and pins on an empty background,
so the operator can't see where the site actually is. D8 left out a basemap because the app works
offline and its CSP only allows images from the local backend.

## 2. Decision

| # | Decision | Why |
|---|---|---|
| B1 | The backend proxies keyless public tile servers through `GET /api/v1/basemap/{source}/{z}/{x}/{y}` and keeps every tile it fetches in a disk cache under app-data. | The CSP stays unchanged (images still come only from `127.0.0.1`). No API keys. A site that was opened once also works offline. |
| B2 | Two sources: `satellite` (Esri World Imagery) and `streets` (OpenStreetMap standard). The pane shows satellite by default and has a small toggle. | Satellite is the useful backdrop for drone sites. OSM is the clean-licence alternative. Both are keyless. |
| B3 | The tiles go into the **existing SVG** as `<image>` elements, positioned by the SVG frame's own `project()`. Still no OpenLayers instance, so D8's reasoning holds. | Over a site-sized area, the frame's local equirectangular projection and web mercator differ by far less than a pixel. All existing drawing, theming and tests stay as they are. |
| B4 | Offline or unreachable: the endpoint answers 503 `basemap_unavailable`. After a failure, uncached tiles answer 503 at once for 60 s instead of waiting out timeouts. The pane hides tiles that fail, so the drawing looks exactly like today's. | The landing page must never stall or show an error because of the basemap. |
| B5 | Attribution text ("© Esri" / "© OpenStreetMap contributors") sits in the pane's corner while tiles are shown. | Both providers require it. |

Requests carry the User-Agent `KestrelAI-desktop/<version>`, as the OSM tile usage policy requires.
There is no bulk prefetch: tiles are fetched only for what the pane shows, which the policy also
requires.

## 3. Budget

- **Background job:** none. One tile is ≤ ~60 KB and one HTTP GET (5 s timeout). The request runs on
  FastAPI's threadpool, so it never blocks the event loop. The pane asks for at most 9 tiles (§4).
- **Bounded reads:** the pane picks a zoom so that the frame's larger side spans about 2 tiles,
  which gives ≤ 3×3 tiles, capped at zoom 19. The disk cache grows only by the tiles of sites the
  operator actually views (around 9 per site).

## 4. Components

- `backend/app/basemap/`: `sources.py` (URL templates, media types, max zoom), `service.py`
  (cache path, `download` seam, failure back-off), `router.py`.
- `contract/openapi.yaml`: `getBasemapTile` and the generated `schema.d.ts`; `basemapTileUrl()` in
  `contract/client/index.ts`.
- `frontend/src/overview/basemapTiles.ts`: pure `(frame, bounds) → tiles[]` (zoom choice, tile
  rectangles in frame units).
- `SiteLocation.tsx`: a clipped `<g data-testid="basemap">` under the drawing, plus the toggle and
  attribution. `siteFrame` gains an `unproject` for the frame extent.

## 5. Execution DAG

The independent units are A (backend + contract) and B (`basemapTiles.ts`, pure). C (wiring into
`SiteLocation`) depends on both. Critical path: A → C. The work is small, so it is built in one
worktree: A and B first, then C.

## 6. Testing

- Backend: cache miss downloads and stores the tile; a hit never downloads; an unknown source → 422;
  z above the source's max → 422; a failed download → 503, with no second attempt inside the
  back-off window. The contract test runs offline through a conftest `download` stub.
- Frontend: tile maths (zoom choice, ≤ 9 tiles, rectangles cover the frame); the pane renders
  tiles with token URLs; a failed tile is hidden; attribution follows the source; the toggle switches
  the source.
