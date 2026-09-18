export interface Command {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/** Shared by a command's undo and redo: redoing a create yields a new server id. */
export interface BoxRef {
  id: string;
}

/** Per-image undo/redo stack of compensating API calls (spec section 6). */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();
  version = 0;

  constructor(private readonly limit = 100) {}

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
    if (!cmd) return null;
    await cmd.undo();
    this.undoStack.pop();
    this.redoStack.push(cmd);
    this.bump();
    return cmd;
  }

  async redo(): Promise<Command | null> {
    const cmd = this.redoStack[this.redoStack.length - 1];
    if (!cmd) return null;
    await cmd.redo();
    this.redoStack.pop();
    this.undoStack.push(cmd);
    this.bump();
    return cmd;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
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
