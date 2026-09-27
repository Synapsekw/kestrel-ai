import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { toast } from "@/ui";
import { arrivalRequest, stripArrival } from "../arrival/arrival";
import { resolveArrival } from "../arrival/resolveArrival";
import { useWorkspaceStores } from "../context";
import { toolRegistry } from "../tools/toolStore";
import { parseViewParams, writeViewParams } from "./viewParams";

/**
 * Keeps `?l=&r=&mode=&sel=` and the store in step (spec §5), and runs arrivals (`finding`, `map`, `at`,
 * `tool`; R-W1-6): URL → store on load and on any navigation that is not our own write; store → URL
 * (replace) on every view change. While an arrival resolves, store changes are not written, so the
 * arrival params are dropped in one write at its end.
 */
export function useUrlState(ready: boolean): void {
  const { workspace, tools, projectId, frame } = useWorkspaceStores();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paramsRef = useRef(params);
  const own = useRef<string | null>(null);
  const arriving = useRef(false);
  useEffect(() => {
    paramsRef.current = params;
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
      own.current = next.toString();
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
    if (params.toString() === own.current) return;
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
      if (out.r) st.hydrate({ r: out.r });
      if (out.selection) st.select(out.selection);
      if (out.centre) st.viewApi?.centreOn(out.centre, out.resolution ?? undefined);
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
