export function Splash({ message = "Starting backend" }: { message?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-slate-900 text-slate-100">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-orange-500"
        role="status"
        aria-label="Loading"
      />
      <p className="text-lg">{message}</p>
    </div>
  );
}
