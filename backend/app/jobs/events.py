"""In-process event bus fanned out to websocket clients (spec section 9, `ws /events`)."""

import asyncio
import logging

from fastapi import WebSocket

log = logging.getLogger(__name__)


class EventBus:
    def __init__(self):
        self._subs: set[asyncio.Queue] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, event: dict) -> None:
        """Safe to call from worker threads."""
        if self._loop is None or self._loop.is_closed():
            return
        try:
            self._loop.call_soon_threadsafe(self._fanout, event)
        except RuntimeError:  # loop shutting down
            pass

    def _fanout(self, event: dict) -> None:
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                log.warning("event subscriber is not keeping up; dropping %s", event.get("type"))


async def events_websocket(ws: WebSocket) -> None:
    from app.auth import ws_token_ok

    if not ws_token_ok(ws):
        await ws.close(code=4401)
        return
    await ws.accept()
    bus: EventBus = ws.app.state.events
    q = bus.subscribe()
    try:
        while True:
            ev = await q.get()
            await ws.send_json(ev)
    except Exception:  # client went away
        pass
    finally:
        bus.unsubscribe(q)
