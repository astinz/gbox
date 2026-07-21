import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "compact" | "wide";
  dismissible?: boolean;
  bodyClassName?: string;
};

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "wide",
  dismissible = true,
  bodyClassName,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("app-dialog", width === "wide" ? "sm:max-w-5xl" : "sm:max-w-xl")}
        showCloseButton={dismissible}
      >
        <DialogHeader className="app-dialog__header">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="app-dialog__scroll">
          <div className={cn("app-dialog__body", bodyClassName)}>{children}</div>
        </ScrollArea>
        {footer ? <DialogFooter className="app-dialog__footer">{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
