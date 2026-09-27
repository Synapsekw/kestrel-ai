import type { SegmentCrop, SegmentPoint } from "../api";

export type Device = "cuda" | "cpu";
export type SamStatus = "idle" | "preparing" | "ready" | "unavailable" | "error";

export interface SamState {
  status: SamStatus;
  /** The crop key being prepared or prepared. */
  key: string | null;
  /** The server's crop (sent back on every segment call). */
  crop: SegmentCrop | null;
  points: SegmentPoint[];
  polygon: number[][] | null;
  /** The last answer was "nothing found here". */
  empty: boolean;
  /** A click fell outside the prepared crop (R-FA8). */
  outside: boolean;
  device: Device | null;
  /**
   * Assist model state behind `unavailable`: missing | invalid | unavailable (SAM failed to load; the
   * server retries on every prepare, so `retry()` may recover) | absent (no assist routes in this build).
   */
  reason: string | null;
  error: string | null;
  /** Bumped per point change; a segment answer for an older seq is ignored. */
  seq: number;
  busy: boolean;
}

export const INITIAL_SAM: SamState = {
  status: "idle",
  key: null,
  crop: null,
  points: [],
  polygon: null,
  empty: false,
  outside: false,
  device: null,
  reason: null,
  error: null,
  seq: 0,
  busy: false,
};

export type SamAction =
  | { type: "prepare"; key: string }
  | { type: "prepared"; key: string; crop: SegmentCrop; device: Device }
  | { type: "point"; point: SegmentPoint }
  | { type: "outside" }
  | { type: "removeLast" }
  | { type: "segmenting" }
  | { type: "segmented"; seq: number; polygon: number[][] | null; device: Device }
  | { type: "unavailable"; state: string }
  | { type: "failed"; message: string }
  | { type: "cancel" }
  | { type: "reset" };

export function samReducer(s: SamState, a: SamAction): SamState {
  switch (a.type) {
    case "prepare":
      return { ...s, status: "preparing", key: a.key, error: null };
    case "prepared":
      if (s.key !== null && s.key !== a.key) return s;
      return { ...s, status: "ready", key: a.key, crop: a.crop, device: a.device };
    case "point":
      return { ...s, points: [...s.points, a.point], seq: s.seq + 1, outside: false, empty: false };
    case "outside":
      return { ...s, outside: true };
    case "removeLast": {
      const points = s.points.slice(0, -1);
      return {
        ...s,
        points,
        seq: s.seq + 1,
        polygon: points.length ? s.polygon : null,
        empty: false,
        outside: false,
      };
    }
    case "segmenting":
      return { ...s, busy: true };
    case "segmented":
      if (a.seq !== s.seq) return { ...s, busy: false };
      return {
        ...s,
        // A decode that answers after a failed one clears the error.
        status: s.status === "error" && s.crop ? "ready" : s.status,
        error: s.status === "error" && s.crop ? null : s.error,
        busy: false,
        polygon: a.polygon,
        empty: a.polygon === null,
        device: a.device,
      };
    case "unavailable":
      return { ...INITIAL_SAM, status: "unavailable", reason: a.state };
    case "failed":
      return { ...s, status: "error", busy: false, error: a.message };
    case "cancel":
      return { ...s, points: [], polygon: null, empty: false, outside: false, seq: s.seq + 1, busy: false };
    case "reset":
      return INITIAL_SAM;
  }
}
