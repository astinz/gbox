import {
  BlocksIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  BellIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { SystemStatus } from "@/types/gbox";

type Props = {
  status: SystemStatus;
  onObservationChange: (enabled: boolean) => void;
  onLaunchAtLoginChange: (enabled: boolean) => void;
  onNotchChange: (enabled: boolean) => void;
};

export function StatusBoard({
  status,
  onObservationChange,
  onLaunchAtLoginChange,
  onNotchChange,
}: Props) {
  const checks = [
    { label: "Codex", value: status.codexSupported, icon: BlocksIcon, detail: status.codexSupported ? "available" : "needs setup" },
    { label: "Codex connection", value: status.pluginInstalled && status.hooksTrusted, icon: CheckCircle2Icon, detail: status.pluginInstalled && status.hooksTrusted ? "ready" : "needs review" },
    {
      label: "Evidence sources",
      value: status.evidenceSourcesReady,
      icon: CheckCircle2Icon,
      detail: status.evidenceSourcesReady ? `${status.evidenceSourceCount} available` : "none available",
    },
    { label: "Alerts", value: status.notificationsAvailable, icon: BellIcon, detail: status.notificationsAvailable ? "available" : "shown in gBox" },
  ];

  return (
    <Card className="status-card h-full">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Readiness</CardTitle>
          <Badge variant={status.replayMode ? "secondary" : "outline"}>
            {status.replayMode ? "Demo" : "Active"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          {checks.map(({ label, value, icon: Icon, detail }) => (
            <div className="status-row" key={label}>
              <Icon className="size-4" aria-hidden="true" />
              <span className="font-medium">{label}</span>
              <span className="truncate text-xs text-muted-foreground">{detail}</span>
              <span className={value ? "status-dot status-dot--ok" : "status-dot"}>
                <span className="sr-only">{value ? "ready" : "not ready"}</span>
              </span>
            </div>
          ))}
        </div>
        <Field orientation="horizontal" className="consent-field">
          <FieldContent>
            <FieldTitle>Monitor Codex research</FieldTitle>
            <FieldDescription>
              Check important claims after each completed response.
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="Monitor Codex research"
            checked={status.globalObservation}
            onCheckedChange={onObservationChange}
          />
        </Field>
        {status.notchAvailable ? (
          <Field orientation="horizontal" className="consent-field">
            <FieldContent>
              <FieldTitle>Top-of-screen updates</FieldTitle>
              <FieldDescription>
                Show new checks and results around the Mac camera area.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Top-of-screen updates"
              checked={status.notchEnabled}
              onCheckedChange={onNotchChange}
            />
          </Field>
        ) : null}
        <Field orientation="horizontal" className="consent-field">
          <FieldContent>
            <FieldTitle>Open gBox at login</FieldTitle>
            <FieldDescription>
              Keep monitoring available after restart without opening the main window.
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="Open gBox at login"
            checked={status.launchAtLogin}
            onCheckedChange={onLaunchAtLoginChange}
          />
        </Field>
        {status.globalObservation && !status.notificationsAvailable && (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>System alerts unavailable</AlertTitle>
            <AlertDescription>
              Monitoring remains active. Completed checks will stay visible in gBox.
            </AlertDescription>
          </Alert>
        )}
        {!status.receiptChainValid && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Decision history needs attention</AlertTitle>
            <AlertDescription>Some saved decision records may have changed.</AlertDescription>
          </Alert>
        )}
        {status.diagnostic && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            gBox needs attention. Restart the app or use the guided demo while the connection recovers.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
