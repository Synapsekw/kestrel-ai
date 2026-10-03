import type { SceneCloud } from "@/api/siteScene";

/** F0's scene manifest (`getSiteScene`). Never `components["schemas"]["SiteFrame"]`: that is the map workspace frame. */
export type { SiteScene } from "@/api/siteScene";
export type SiteCloud = SceneCloud;
