import { create } from "zustand";

export type ToastTone = "info" | "ok" | "danger";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  text: string;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/** At most this many toasts on screen; the oldest goes when a new one arrives. */
export const MAX_TOASTS = 3;

let seq = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = `toast-${++seq}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Show a toast from anywhere (hooks, stores, event handlers). Returns its id. */
export function toast(tone: ToastTone, text: string, action?: ToastAction): string {
  return useToastStore.getState().push({ tone, text, action });
}

export function dismissToast(id: string): void {
  useToastStore.getState().dismiss(id);
}
