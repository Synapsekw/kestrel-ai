import { CloudWorkspace } from "@/clouds/workspace/CloudWorkspace";

/**
 * The Point clouds route body (spec C1, §5 "Screen"): `/p/:projectId/clouds/:cloudId?`, which is
 * the S1 jump contract (`?at=x,y[&fp=…]`) that the maps → 3D jump, the Volumes screen's "View in
 * 3D" and `check:webview` use. The screen itself is `CloudWorkspace`; this name stays because the
 * lazy route table and those callers import it.
 */
export function CloudsScreen() {
  return <CloudWorkspace />;
}
