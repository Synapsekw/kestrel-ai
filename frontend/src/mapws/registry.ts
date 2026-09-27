import { useMemo, useSyncExternalStore } from "react";

/**
 * A plugin registry (R-W1-1): definitions keyed by id, the last registration of an id wins, and
 * components re-render when one is added. W2–W5 never call `register` by hand in production; files
 * matching the plugin patterns are registered by mapws/plugins.ts.
 */
export class Registry<T extends { id: string }> {
  private readonly items = new Map<string, T>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  register(item: T): () => void {
    this.items.set(item.id, item);
    this.bump();
    return () => {
      if (this.items.get(item.id) !== item) return;
      this.items.delete(item.id);
      this.bump();
    };
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

export function useRegistry<T extends { id: string }>(registry: Registry<T>): T[] {
  const version = useSyncExternalStore(registry.subscribe, registry.getVersion, registry.getVersion);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the registry's change signal
  return useMemo(() => registry.all(), [registry, version]);
}
