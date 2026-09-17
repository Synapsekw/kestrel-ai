import { useEffect, type ReactNode } from "react";
import { RouterProvider } from "react-router-dom";
import { eventsUrl } from "@contract/client";
import { ApiProvider, useBackend } from "@/api/client";
import { connectEvents } from "@/api/events";
import { ErrorBoundary } from "@/app/ErrorBoundary";
import { useJobsStore } from "@/store/jobs";
import { router } from "@/routes";

/** Keeps the jobs store fed by the backend event websocket for as long as the app is mounted. */
function EventsBridge({ children }: { children: ReactNode }) {
  const info = useBackend();
  useEffect(
    () => connectEvents(eventsUrl(info.baseUrl, info.token), useJobsStore.getState().applyEvent),
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
