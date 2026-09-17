class EventBus:
    def bind(self, loop) -> None:
        pass


async def events_websocket(ws):
    await ws.close(code=4401)
