import type { FindingStatus } from "@/api/findings";

export const STATUSES: readonly FindingStatus[] = ["open", "reviewed", "closed"];

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  reviewed: "Reviewed",
  closed: "Closed",
};

/** F §8.2: every move is allowed except closed → reviewed (reopen first). */
export function canTransition(from: FindingStatus, to: FindingStatus): boolean {
  return from !== to && !(from === "closed" && to === "reviewed");
}
