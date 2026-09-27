const key = (projectId: string) => `kestrel.images.lastType.${projectId}`;

function read(projectId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The last type used with a tool in a project (spec §9.2); storage failures are ignored. */
export function rememberedType(projectId: string, toolId: string): string | null {
  return read(projectId)[toolId] ?? null;
}

export function rememberType(projectId: string, toolId: string, typeId: string): void {
  try {
    localStorage.setItem(key(projectId), JSON.stringify({ ...read(projectId), [toolId]: typeId }));
  } catch {
    // Private mode or a full quota: the choice is simply not remembered.
  }
}
