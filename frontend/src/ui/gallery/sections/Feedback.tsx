import { Button, Disclosure, EmptyState, Icon, Progress, Skeleton, SkeletonRows, toast } from "@/ui";
import { ICON_NAMES } from "@/ui/Icon";

export const title = "Feedback";
export const order = 30;

export default function FeedbackSection() {
  return (
    <div className="grid max-w-3xl gap-8">
      <div className="grid gap-3">
        <Progress value={0.3} label="Import" />
        <Progress value={0.68} running label="Training" />
        <Progress label="Queued" />
      </div>
      <div className="grid gap-3">
        <Skeleton className="h-8 w-64" />
        <SkeletonRows rows={3} columns={4} />
      </div>
      <EmptyState
        icon="findings"
        title="No findings yet"
        action={
          <Button variant="primary" icon="plus">
            Add data
          </Button>
        }
      >
        Findings appear when a defect is marked on an image, a map or a point cloud.
      </EmptyState>
      <div className="flex gap-2">
        <Button onClick={() => toast("ok", "Saved")}>Toast: ok</Button>
        <Button onClick={() => toast("info", "Visual effects reduced", { label: "Undo", onClick: () => {} })}>
          Toast: with action
        </Button>
        <Button onClick={() => toast("danger", "Couldn't reach the backend")}>Toast: danger</Button>
      </div>
      <Disclosure label="More options" summary="6 settings">
        <p className="text-sm text-muted">Revealed content.</p>
      </Disclosure>
      <div className="grid grid-cols-8 gap-3">
        {ICON_NAMES.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1 text-2xs text-muted">
            <Icon name={name} size={20} className="text-ink" />
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}
