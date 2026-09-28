import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { toast } from "@/ui";
import { arrivalRequest, asksToCentre, stripArrival } from "../arrival/arrival";
import { resolveArrival } from "../arrival/resolveArrival";
import { useWorkspaceStores } from "../context";
import { toolRegistry } from "../tools/toolStore";
import { parseViewParams, writeViewParams } from "./viewParams";

/**
 * Keeps `?l=&r=&mode=&sel=` and the store in step (spec §5), and runs arrivals (`finding`, `map`, `at`,
 * `tool`; R-W1-6): URL → store on load and on any navigation that is not our own write; store → URL
 * (replace) on every view change. While an arrival resolves, store changes are not written, so the
 * arrival params are dropped in one write at its end. `onUncentredArrival` runs when an arrival that
 * asked to centre (a finding, a map with `at`) settles without a centre, so the caller can fit the site.
 */
export function useUrlState(ready: boolean, onUncentredArrival?: () => void): void {
  const { workspace, tools, projectId, frame } = useWorkspaceStores();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  // Our own writes, oldest first, until the router shows the latest back. A second store change can
  // land before the effect for the first write runs; with only the latest remembered, that first
  // write would read as a foreign navigation and revert the store to it (a dropped [ ] or Esc).
  const own = useRef<string[]>([]);
  const arriving = useRef(false);
  const uncentredRef = useRef(onUncentredArrival);
  useEffect(() => {
    paramsRef.current = params;
    uncentredRef.current = onUncentredArrival;
  });

  const writeFrom = useCallback(
    (from: URLSearchParams) => {
      const s = workspace.getState();
      const next = writeViewParams(from, {
        l: s.l,
        r: s.r,
        mode: s.mode,
        selection: s.selection,
      });
      if (next.toString() === paramsRef.current.toString()) return;
      own.current.push(next.toString());
      if (own.current.length > 16) own.current.shift();
      paramsRef.current = next;
      setParams(next, { replace: true });
    },
    [workspace, setParams],
  );

  useEffect(() => {
    if (!ready) return;
    return workspace.subscribe((s, prev) => {
      if (arriving.current) return;
      if (s.l === prev.l && s.r === prev.r && s.mode === prev.mode && s.selection === prev.selection) return;
      writeFrom(paramsRef.current);
    });
  }, [ready, workspace, writeFrom]);

  useEffect(() => {
    if (!ready) return;
    const shown = params.toString();
    if (shown === own.current.at(-1)) {
      own.current = [shown]; // the router has caught up with our latest write
      return;
    }
    if (own.current.includes(shown)) return; // an older write of ours, already superseded
    own.current = [];
    const s = workspace.getState();
    const req = arrivalRequest(params);
    if (req.kind === "none") {
      const v = parseViewParams(params);
      s.hydrate({
        ...(v.mode ? { mode: v.mode } : {}),
        ...(v.l ? { l: v.l } : {}),
        ...(v.r ? { r: v.r } : {}),
      });
      if (v.sel !== undefined) s.select(v.sel);
      writeFrom(params);
      return;
    }
    let cancelled = false;
    arriving.current = true;
    void resolveArrival(req, {
      api,
      projectId,
      frame,
      activateTool: (id) => {
        if (!toolRegistry.get(id)) return false;
        tools.getState().activate(id);
        return true;
      },
    }).then((out) => {
      if (cancelled) return;
      arriving.current = false;
      if (out.navigate) {
        navigate(out.navigate, { replace: true });
        return;
      }
      const st = workspace.getState();
      // Single, so fixDates cannot move r off the map's date to keep l < r (M2).
      if (out.r) st.hydrate({ mode: "single", r: out.r });
      if (out.selection) st.select(out.selection);
      if (out.centre) st.viewApi?.centreOn(out.centre, out.resolution ?? undefined);
      else if (asksToCentre(req)) uncentredRef.current?.();
      if (out.notice) toast("info", out.notice);
      if (out.error) toast("danger", out.error);
      writeFrom(stripArrival(params));
    });
    return () => {
      cancelled = true;
      arriving.current = false;
    };
  }, [params, ready, workspace, tools, api, projectId, frame, navigate, writeFrom]);
}
