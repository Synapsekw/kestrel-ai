import { useEffect, type ReactNode } from "react";
import { RouterProvider } from "react-router-dom";
import { eventsUrl } from "@contract/client";
import { ApiProvider, useBackend } from "@/api/client";
import { connectEvents } from "@/api/events";
import { useProjectAgentEvents } from "@/agent/project/agentEvents";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { router } from "@/routes";

/** Keeps the jobs, change and agent stores fed by the backend event websocket for as long as the app is mounted. */
function EventsBridge({ children }: { children: ReactNode }) {
  const info = useBackend();
  useEffect(
    () =>
      connectEvents(eventsUrl(info.baseUrl, info.token), (ev) => {
        useJobsStore.getState().applyEvent(ev);
        useChangesStore.getState().applyEvent(ev);
        useProjectAgentEvents.getState().applyEvent(ev);
      }),
    [info.baseUrl, info.token],
  );
  return children;
}

export function App() {
  return (
    <ErrorBoundary>
      <ApiProvider>
        <EventsBridge>
          <RouterProvider router={router} />
        </EventsBridge>
      </ApiProvider>
    </ErrorBoundary>
  );
}
