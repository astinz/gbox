import {
  BinaryIcon,
  BlocksIcon,
  CableIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Link2Icon,
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
};

export function StatusBoard({ status, onObservationChange, onLaunchAtLoginChange }: Props) {
  const checks = [
    { label: "Codex CLI", value: status.codexSupported, icon: BinaryIcon, detail: status.codexVersion ?? "not found" },
    { label: "App Server", value: status.appServerConnected, icon: CableIcon, detail: status.appServerConnected ? "JSONL connected" : "starts on first live task" },
    { label: "Control plugin", value: status.pluginInstalled, icon: BlocksIcon, detail: status.pluginInstalled ? "installed" : "install from local marketplace" },
    { label: "Trusted hooks", value: status.hooksTrusted, icon: Link2Icon, detail: status.hooksTrusted ? "trusted" : "review with /hooks" },
    {
      label: "Evidence sources",
      value: status.evidenceSourcesReady,
      icon: CheckCircle2Icon,
      detail: status.evidenceSourcesReady ? `${status.evidenceSourceCount} available` : "connect App Server to discover",
    },
  ];

  return (
    <Card className="status-card h-full">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Control plane</CardTitle>
          <Badge variant={status.replayMode ? "secondary" : "outline"}>
            {status.replayMode ? "Replay" : "Live"}
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
            <FieldTitle>Global Codex observation</FieldTitle>
            <FieldDescription>
              When enabled, trusted Stop hooks forward final assistant messages for claim extraction.
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="Global Codex observation"
            checked={status.globalObservation}
            onCheckedChange={onObservationChange}
          />
        </Field>
        <Field orientation="horizontal" className="consent-field">
          <FieldContent>
            <FieldTitle>Launch gBox at login</FieldTitle>
            <FieldDescription>
              Starts the background observer with its window hidden. This setting is independent of observation.
            </FieldDescription>
          </FieldContent>
          <Switch
            aria-label="Launch gBox at login"
            checked={status.launchAtLogin}
            onCheckedChange={onLaunchAtLoginChange}
          />
        </Field>
        {status.globalObservation && !status.notificationsAvailable && (
          <Alert>
            <CircleAlertIcon />
            <AlertTitle>Native notifications unavailable</AlertTitle>
            <AlertDescription>
              Observation remains active. Completed checks will stay visible in gBox.
            </AlertDescription>
          </Alert>
        )}
        {!status.receiptChainValid && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Receipt chain integrity failure</AlertTitle>
            <AlertDescription>Stored receipt hashes no longer form a valid chain.</AlertDescription>
          </Alert>
        )}
        {status.diagnostic && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {status.diagnostic}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
