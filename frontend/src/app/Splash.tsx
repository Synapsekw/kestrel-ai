import { Brand } from "./Brand";
import { Progress } from "@/ui";

export function Splash({ message = "Starting the backend" }: { message?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 bg-bg text-ink">
      <Brand size="lg" />
      <p role="status" className="text-sm text-muted">
        {message}
      </p>
      <Progress thin label="Loading" className="w-40" />
    </div>
  );
}
