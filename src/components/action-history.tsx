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
          <div><p className="eyebrow">Side effects</p><h2 className="panel-title">Action history</h2></div>
          <WebhookIcon className="size-5 text-muted-foreground" />
        </div>
        <ScrollArea className="h-[330px]">
          <div className="divide-y">
            {actions.length === 0 && <p className="p-6 text-sm text-muted-foreground">No protected actions yet.</p>}
            {actions.map((action) => (
              <article className="history-row" key={action.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{action.actionType.replace(/_/g, " ")}</span>
                  <Badge variant={action.state === "Denied" || action.state === "Failed" ? "destructive" : "outline"}>{action.state}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{action.reportMarkdown}</p>
                <code className="mt-2 block truncate text-[10px] text-muted-foreground">sha256:{action.payloadHash}</code>
              </article>
            ))}
          </div>
        </ScrollArea>
      </section>
      <section className="panel-surface">
        <div className="panel-toolbar">
          <div><p className="eyebrow">Tamper evidence</p><h2 className="panel-title">Receipt chain</h2></div>
          <FileCheck2Icon className="size-5 text-muted-foreground" />
        </div>
        <ScrollArea className="h-[330px]">
          <div className="divide-y">
            {receipts.length === 0 && <p className="p-6 text-sm text-muted-foreground">No receipts recorded yet.</p>}
            {receipts.map((receipt) => (
              <article className="history-row" key={receipt.id}>
                <div className="flex items-center gap-2">
                  <FingerprintIcon className="size-4 text-accent-foreground" />
                  <span className="font-medium">#{receipt.sequence} {receipt.eventType}</span>
                </div>
                <code className="mt-2 block truncate text-[10px] text-muted-foreground">{receipt.hash}</code>
                <p className="mt-1 text-[11px] text-muted-foreground">Previous: {receipt.previousHash === "GENESIS" ? "GENESIS" : receipt.previousHash.slice(0, 16)}</p>
              </article>
            ))}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
