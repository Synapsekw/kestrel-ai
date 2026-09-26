import { Navigate, useLocation, useParams, type Params } from "react-router-dom";

/**
 * Replaces an old address with its new one, keeping the old query string and hash (a toast's
 * `?job=`, a library `?model=`); query parameters named in `to` are added on top.
 */
export function Redirect({ to }: { to: (params: Params<string>) => string }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const [path, query = ""] = to(params).split("?");
  const merged = new URLSearchParams(search);
  new URLSearchParams(query).forEach((value, key) => merged.set(key, value));
  const qs = merged.toString();
  return <Navigate to={`${path}${qs ? `?${qs}` : ""}${hash}`} replace />;
}
