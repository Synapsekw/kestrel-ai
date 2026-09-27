import type { Survey } from "../types";

export interface Tick {
  date: string;
  /** 0–1 along the track, by time; a lone tick sits in the middle. */
  pos: number;
  /** Planned surveys are dashed and cannot be selected (M §5, §14). */
  planned: boolean;
  /** The date is the import date: the survey date has not been set. */
  importDate: boolean;
  mapIds: string[];
  surfaceIds: string[];
}

export interface DatePair {
  l: string | null;
  r: string | null;
}

const PAD = 0.04;
const DAY_MS = 86_400_000;
/**
 * Fixed en-GB short month names, not `Intl.DateTimeFormat`: the ICU/CLDR data bundled with Node
 * varies by version and some builds render "Sept" instead of "Sep" for `month: "short"`, which
 * would make this drift by runtime (global constraints: dates show as `14 Sep 2026` / `14 Sep`).
 */
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const ms = (date: string): number => Date.parse(`${date}T00:00:00Z`);

export function formatSurveyDate(date: string | null, short = false): string {
  if (!date) return "date not set";
  const d = new Date(ms(date));
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()];
  return short ? `${day} ${month}` : `${day} ${month} ${d.getUTCFullYear()}`;
}

/** One tick per date, oldest first, positioned by time. */
export function buildTicks(surveys: readonly Survey[]): Tick[] {
  const byDate = new Map<string, Omit<Tick, "pos">>();
  for (const s of surveys) {
    const t = byDate.get(s.date);
    if (!t) {
      byDate.set(s.date, {
        date: s.date,
        planned: s.planned,
        importDate: s.date_is_import_date,
        mapIds: s.maps.map((m) => m.id),
        surfaceIds: s.surfaces.map((x) => x.id),
      });
      continue;
    }
    t.planned = t.planned && s.planned;
    t.importDate = t.importDate && s.date_is_import_date;
    t.mapIds.push(...s.maps.map((m) => m.id));
    t.surfaceIds.push(...s.surfaces.map((x) => x.id));
  }
  const sorted = [...byDate.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  if (sorted.length === 0) return [];
  const t0 = ms(sorted[0].date);
  const span = ms(sorted[sorted.length - 1].date) - t0;
  return sorted.map((t) => ({
    ...t,
    pos: span === 0 ? 0.5 : PAD + ((ms(t.date) - t0) / span) * (1 - 2 * PAD),
  }));
}

const before = (dates: readonly string[], d: string) =>
  dates.filter((x) => x < d).at(-1) ?? null;
const after = (dates: readonly string[], d: string) =>
  dates.find((x) => x > d) ?? null;

/** Ruling W2-2. Null when the pick is refused (planned, unknown, or no room on the other side). */
export function pickDate(
  pair: DatePair,
  which: "l" | "r",
  date: string,
  dates: readonly string[],
  compare: boolean,
): DatePair | null {
  if (!dates.includes(date)) return null;
  if (!compare) return which === "r" ? { ...pair, r: date } : null;
  if (which === "l") {
    if (pair.r !== null && date >= pair.r) {
      const next = after(dates, date);
      return next ? { l: date, r: next } : null;
    }
    return { ...pair, l: date };
  }
  if (pair.l !== null && date <= pair.l) {
    const prev = before(dates, date);
    return prev ? { l: prev, r: date } : null;
  }
  return { ...pair, r: date };
}

/** Ruling W2-3: in a compare mode the nearer marker moves (a tie moves R). */
export function clickTick(
  pair: DatePair,
  tick: Tick,
  ticks: readonly Tick[],
  compare: boolean,
): DatePair | null {
  if (tick.planned) return null;
  const dates = ticks.filter((t) => !t.planned).map((t) => t.date);
  if (!compare) return pickDate(pair, "r", tick.date, dates, false);
  const posOf = (d: string | null) =>
    ticks.find((t) => t.date === d)?.pos ?? Number.POSITIVE_INFINITY;
  const which =
    Math.abs(tick.pos - posOf(pair.l)) < Math.abs(tick.pos - posOf(pair.r))
      ? "l"
      : "r";
  return pickDate(pair, which, tick.date, dates, true);
}

export function rangeText(pair: DatePair, compare: boolean): string {
  if (pair.r === null) return "No surveys yet";
  if (!compare || pair.l === null) return formatSurveyDate(pair.r);
  const days = Math.round((ms(pair.r) - ms(pair.l)) / DAY_MS);
  return `${formatSurveyDate(pair.l, true)} → ${formatSurveyDate(pair.r, true)} · ${days} ${days === 1 ? "day" : "days"}`;
}

export function summaryText(ticks: readonly Tick[]): string {
  const flown = ticks.filter((t) => !t.planned).length;
  const planned = ticks.length - flown;
  return `Survey timeline · ${flown} ${flown === 1 ? "flight" : "flights"}${planned ? `, ${planned} planned` : ""}`;
}
