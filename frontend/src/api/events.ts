import type { AppEvent } from "@contract/client";
import { pushLog } from "@/app/diagnostics";

/** Subscribe to the backend event websocket; reconnects with backoff from 1 s to 10 s. */
export function connectEvents(url: string, onEvent: (ev: AppEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 1000;
  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      delay = 1000;
      pushLog("events: connected");
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data as string) as AppEvent);
      } catch (e) {
        pushLog(`events: bad message ${e}`);
      }
    };
    ws.onclose = () => {
      if (closed) return;
      pushLog(`events: closed, retry in ${delay} ms`);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
