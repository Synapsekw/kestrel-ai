import { useState } from "react";
import { Pill } from "@/ui/Pill";
import { StatTile } from "@/ui/StatTile";

export const title = "Stats";
export const order = 60;

const TREND = Array.from({ length: 30 }, (_, i) => 30 + Math.round(12 * Math.sin(i / 4)) + i);

export default function StatsSection() {
  const [run, setRun] = useState(0);
  const [open, setOpen] = useState(47);
  return (
    <div className="grid gap-3">
      <div className="flex gap-3 text-sm">
        <button type="button" className="text-accent-ink underline" onClick={() => setRun((r) => r + 1)}>
          Replay (remount)
        </button>
        <button type="button" className="text-accent-ink underline" onClick={() => setOpen((n) => n + 13)}>
          Add 13 open findings
        </button>
      </div>
      <div key={run} className="grid grid-cols-4 gap-3.5">
        <StatTile
          label="Open findings"
          value={open}
          delta={{ value: 5, good: "down", label: "vs 7 days ago" }}
          spark={TREND}
          sparkLabel="Open findings, last 30 days"
        />
        <StatTile
          label="Critical"
          value={6}
          tone="danger"
          delta={{ value: -3, good: "down", label: "closed this week" }}
        />
        <StatTile
          label="Project data"
          value={1284}
          unit="images"
          chips={
            <>
              <Pill size="sm">3 maps</Pill>
              <Pill size="sm">2 clouds</Pill>
              <Pill size="sm">1 DSM</Pill>
            </>
          }
        />
        <StatTile label="Stockpile volume" value={12480.5} unit="m³" delta={{ value: 320, good: "up" }} />
      </div>
    </div>
  );
}
