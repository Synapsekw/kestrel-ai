export interface CpuProfileNode {
  id: number;
  callFrame: { functionName: string; url?: string };
  hitCount?: number;
  children?: number[];
}
export interface CpuProfile {
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas?: number[];
  nodes: CpuProfileNode[];
}
export interface FrameStats {
  samples: number;
  p50: number;
  p95: number;
  max: number;
}
export function percentileOf(sorted: number[], q: number): number;
export function frameStats(values: number[]): FrameStats;
export function profileTotals(profile: CpuProfile, names: string[]): Record<string, number>;
export function pinGrid(bounds: number[], n: number): Array<[number, number]>;
export function insideClipBox(
  p: [number, number, number],
  box: { centre: number[]; size: number[]; yaw_deg: number },
  tol?: number,
): boolean;
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null;
export function colourSpread(samples: number[]): { distinct: number; nonBackground: number };
export function coverageCounts(
  coverage: {
    result: Array<{
      url?: string;
      functions: Array<{ functionName: string; ranges: Array<{ count: number }> }>;
    }>;
  },
  names: string[],
): Record<string, number>;
export function ringTail(
  before: number[],
  after: number[],
  expected?: number,
  capacity?: number,
): { tail: number[]; n: number; exact: boolean };
