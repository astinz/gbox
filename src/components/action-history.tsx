import { FileCheck2Icon, FingerprintIcon, WebhookIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { PendingAction, Receipt } from "@/types/gbox";

type Props = { actions: PendingAction[]; receipts: Receipt[] };

export function ActionHistory({ actions, receipts }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel-surface">
        <div className="panel-toolbar">
          <div><p className="eyebrow">Approval requests</p><h2 className="panel-title">Decisions</h2></div>
          <WebhookIcon className="size-5 text-muted-foreground" />
        </div>
        <ScrollArea className="h-[330px]">
          <div className="divide-y">
            {actions.length === 0 && <p className="p-6 text-sm text-muted-foreground">No decisions yet.</p>}
            {actions.map((action) => (
              <article className="history-row" key={action.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{actionLabel(action.actionType)}</span>
                  <Badge variant={action.state === "Denied" || action.state === "Failed" ? "destructive" : "outline"}>{action.state}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{action.reportMarkdown}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">Integrity proof stored</p>
              </article>
            ))}
          </div>
        </ScrollArea>
      </section>
      <section className="panel-surface">
        <div className="panel-toolbar">
          <div><p className="eyebrow">Record integrity</p><h2 className="panel-title">Decision history</h2></div>
          <FileCheck2Icon className="size-5 text-muted-foreground" />
        </div>
        <ScrollArea className="h-[330px]">
          <div className="divide-y">
            {receipts.length === 0 && <p className="p-6 text-sm text-muted-foreground">No decision records yet.</p>}
            {receipts.map((receipt) => (
              <article className="history-row" key={receipt.id}>
                <div className="flex items-center gap-2">
                  <FingerprintIcon className="size-4 text-accent-foreground" />
                  <span className="font-medium">Decision record #{receipt.sequence}</span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{receiptDescription(receipt.eventType)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Integrity proof verified</p>
              </article>
            ))}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}

function actionLabel(actionType: string): string {
  if (actionType === "test_webhook") return "Demo report delivery";
  return "Protected delivery";
}

function receiptDescription(eventType: string): string {
  if (eventType.toLowerCase().includes("deny")) return "A delivery was denied.";
  if (eventType.toLowerCase().includes("approve")) return "A delivery was approved.";
  if (eventType.toLowerCase().includes("execut")) return "An approved delivery was completed.";
  return "A decision was recorded.";
}
