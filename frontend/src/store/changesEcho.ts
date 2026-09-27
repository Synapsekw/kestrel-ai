/**
 * Own-write echo dedupe for `findings.changed` (programme rulings R8; the Foundation item parked in
 * docs/evidence/foundation/rulings.md, unit X). A finding write registers the ids it is about to
 * change; the backend's after-commit event (backend/app/findings/events.py) then carries exactly
 * those ids and is consumed instead of bumping `findingsRevision` a second time. The write still
 * bumps once itself, so a closed events socket changes nothing.
 */

/** An expected echo that never came must not swallow a later real change for long. */
export const FINDING_ECHO_TTL_MS = 5_000;
/** Above this many ids the backend sends `{all: true}` (events.py `MAX_IDS`), which never matches. */
export const FINDING_ECHO_MAX_IDS = 100;

export interface EchoEntry {
  /** Echoes still expected for this id: one per own write in flight or just committed. */
  n: number;
  /** Epoch ms after which the entry is dropped, unless a write of it is still in flight. */
  until: number;
  /** Own writes of this id not settled yet: their expectation cannot expire, however slow the
   * request, and the TTL starts again when they succeed (`renewEchoes`). */
  inFlight: number;
}

export type EchoLedger = Readonly<Record<string, EchoEntry>>;

export const EMPTY_LEDGER: EchoLedger = {};

export function pruneLedger(ledger: EchoLedger, now: number): EchoLedger {
  let changed = false;
  const out: Record<string, EchoEntry> = {};
  for (const [id, e] of Object.entries(ledger)) {
    if (e.n > 0 && (e.inFlight > 0 || e.until >= now)) out[id] = e;
    else changed = true;
  }
  return changed ? out : ledger;
}

export function expectEchoes(ledger: EchoLedger, ids: readonly string[], now: number): EchoLedger {
  if (ids.length === 0 || ids.length > FINDING_ECHO_MAX_IDS) return ledger;
  const out: Record<string, EchoEntry> = { ...pruneLedger(ledger, now) };
  for (const id of new Set(ids))
    out[id] = {
      n: (out[id]?.n ?? 0) + 1,
      until: now + FINDING_ECHO_TTL_MS,
      inFlight: (out[id]?.inFlight ?? 0) + 1,
    };
  return out;
}

/** Uses up one expectation per id; `settled` also ends one in-flight write (a failed write). */
function dropOne(ledger: EchoLedger, ids: readonly string[], settled: boolean): EchoLedger {
  let changed = false;
  const out: Record<string, EchoEntry> = { ...ledger };
  for (const id of new Set(ids)) {
    const e = out[id];
    if (!e) continue;
    changed = true;
    if (e.n <= 1) delete out[id];
    else out[id] = { ...e, n: e.n - 1, inFlight: settled ? Math.max(0, e.inFlight - 1) : e.inFlight };
  }
  return changed ? out : ledger;
}

/** A failed write: its echo is no longer expected. */
export function releaseEchoes(ledger: EchoLedger, ids: readonly string[]): EchoLedger {
  return dropOne(ledger, ids, true);
}

/**
 * A successful write: its echo is still expected (unless it already came), for a full TTL from now
 * rather than from when the request started, so a write slower than the TTL keeps its dedupe.
 */
export function renewEchoes(ledger: EchoLedger, ids: readonly string[], now: number): EchoLedger {
  let changed = false;
  const out: Record<string, EchoEntry> = { ...ledger };
  for (const id of new Set(ids)) {
    const e = out[id];
    if (!e) continue;
    changed = true;
    out[id] = { ...e, until: now + FINDING_ECHO_TTL_MS, inFlight: Math.max(0, e.inFlight - 1) };
  }
  return changed ? out : ledger;
}

/** `skip` when every id of the event was expected; those expectations are then used up. */
export function consumeEcho(
  ledger: EchoLedger,
  payload: Record<string, unknown> | undefined,
  now: number,
): { skip: boolean; ledger: EchoLedger } {
  const live = pruneLedger(ledger, now);
  const ids = payload?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return { skip: false, ledger: live };
  if (!ids.every((id): id is string => typeof id === "string")) return { skip: false, ledger: live };
  if (!ids.every((id) => (live[id]?.n ?? 0) > 0)) return { skip: false, ledger: live };
  return { skip: true, ledger: dropOne(live, ids, false) };
}
