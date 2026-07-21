import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { LiveActivityModel } from "@/lib/live-activity";
import { cn } from "@/lib/utils";

export function LiveActivity({ activity }: { activity: LiveActivityModel }) {
  if (!activity.visible) return null;

  const working = activity.phase === "working";
  const history = activity.items.filter(
    (item) => item.label !== activity.headline || item.detail !== activity.detail,
  );
  return (
    <Card
      size="sm"
      className="live-activity"
      aria-live="polite"
      aria-busy={working}
      aria-label="Research progress"
      role="region"
    >
      <CardHeader className="border-b">
        <CardTitle>Research progress</CardTitle>
        <CardDescription>What gBox can safely show while your request is running.</CardDescription>
        <CardAction>
          <Badge variant={activity.phase === "failed" ? "destructive" : working ? "secondary" : "outline"}>
            {working ? <Spinner /> : null}
            {activity.phase === "failed" ? "Needs attention" : working ? "Working" : "Complete"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="live-activity__current">
          <p className="eyebrow">Now</p>
          <p className={cn("mt-1 font-medium", working && "shimmer")}>{activity.headline}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{activity.detail}</p>
        </div>
        {history.length > 0 ? (
          <ol className="live-activity__list">
            {history.map((item) => (
              <li key={item.id} className="live-activity__item">
                <span className={cn(
                  "live-activity__node",
                  item.state === "active" && "live-activity__node--active",
                  item.state === "failed" && "live-activity__node--failed",
                )} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{item.label}</p>
                  {item.detail ? <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{item.detail}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>
      <CardFooter className="text-[10px] leading-relaxed text-muted-foreground">
        Only shareable progress is shown. Private reasoning is never displayed.
      </CardFooter>
    </Card>
  );
}
