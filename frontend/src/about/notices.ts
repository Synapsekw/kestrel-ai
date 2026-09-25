import data from "./notices.json";

export interface Notice {
  id: string;
  name: string;
  version: string;
  licence: string;
  usedFor: string;
  note?: string;
  licenceFile: string;
  text: string;
}

// Every committed licence text, keyed by file name: a new component needs a JSON row and a .txt only.
const texts = import.meta.glob("./licences/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const NOTICES: Notice[] = data.components.map((c) => ({
  ...c,
  text: texts[`./licences/${c.licenceFile}`] ?? "",
}));

/** The Tauri app's version, or the frontend package's when not running inside Tauri. */
export async function appVersion(fallback: string): Promise<string> {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return fallback;
  }
}
