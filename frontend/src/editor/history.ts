export interface Command {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Shared by a command's undo and redo: redoing a create yields a new server id. */
export interface BoxRef {
  id: string;
}

/**
 * Per-image undo/redo stack of compensating API calls (spec section 6). It also serialises the
 * commands of its image (`run`) so history order equals action order, refuses a second undo/redo
 * while one is in flight, and maps ids that changed when a box was re-created (`alias`/`resolve`).
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  private tail: Promise<unknown> = Promise.resolve();
  private aliases = new Map<string, string>();
  private busy = false;
  version = 0;

  constructor(private readonly limit = 100) {}

  /** Queues `fn` behind every earlier call; a rejection does not block later work. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Records that the box once known as `from` now has the server id `to` (redo of a create, undo of a delete). */
  alias(from: string, to: string): void {
    if (from !== to) this.aliases.set(from, to);
  }

  /** The current server id for a box id a command captured earlier. */
  resolve(id: string): string {
    let current = id;
    for (let hops = 0; hops < 1000; hops += 1) {
      const next = this.aliases.get(current);
      if (next === undefined) return current;
      current = next;
    }
    return current;
  }

  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.bump();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  async undo(): Promise<Command | null> {
    const cmd = this.undoStack[this.undoStack.length - 1];
    if (!cmd || this.busy) return null;
    this.busy = true;
    try {
      await cmd.undo();
    } finally {
      this.busy = false;
    }
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.bump();
    return cmd;
  }

  async redo(): Promise<Command | null> {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (!cmd || this.busy) return null;
    this.busy = true;
    try {
      await cmd.redo();
    } finally {
      this.busy = false;
    }
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.bump();
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.aliases.clear();
    this.bump();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }
}
