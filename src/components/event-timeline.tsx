import { BracesIcon, RadioTowerIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CodexEvent } from "@/types/gbox";

export function EventTimeline({ events }: { events: CodexEvent[] }) {
  return (
    <div className="panel-surface">
      <div className="panel-toolbar">
        <div>
          <p className="eyebrow">Upstream telemetry</p>
          <h2 className="panel-title">Codex event stream</h2>
        </div>
        <Badge variant="outline"><RadioTowerIcon /> {events.length} events</Badge>
      </div>
      {events.length === 0 ? (
        <Empty className="min-h-72">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BracesIcon /></EmptyMedia>
            <EmptyTitle>Waiting for App Server events</EmptyTitle>
            <EmptyDescription>Live events are stored exactly as received; replay events are explicitly labelled.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="h-[390px]">
          <ol className="timeline-list">
            {events.map((event) => (
              <li className="timeline-item" key={event.id}>
                <span className={event.source === "replay" ? "timeline-node timeline-node--replay" : "timeline-node"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="truncate text-xs font-semibold">{event.method}</code>
                    {event.source === "replay" && <Badge variant="secondary">replayed</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{event.summary}</p>
                  <time className="mt-1 block font-mono text-[10px] text-muted-foreground/70">{formatTime(event.createdAt)}</time>
                </div>
              </li>
            ))}
          </ol>
        </ScrollArea>
      )}
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}
