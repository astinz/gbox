import { useState } from "react";
import { PlayIcon, RadioIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LiveActivity } from "@/components/live-activity";
import { buildLiveActivity, type LiveActivitySource } from "@/lib/live-activity";
import type { CodexEvent } from "@/types/gbox";

type Props = {
  busy: boolean;
  sessionId?: string;
  events?: CodexEvent[];
  activityStartedAt?: string;
  activitySource?: LiveActivitySource;
  onStartLive: (cwd: string, prompt: string) => void;
  onContinue: (prompt: string) => void;
  onReplay: () => void;
};

const samplePrompt = "Evaluate this intentionally false claim: ‘Acme had 42 production database users in 2026-Q2.’ Use the available company metric MCP to check it, clearly state the contradiction, and prepare a concise report for the gBox test webhook. Do not send it without human approval.";

export function TaskComposer({
  busy,
  sessionId,
  events = [],
  activityStartedAt,
  activitySource,
  onStartLive,
  onContinue,
  onReplay,
}: Props) {
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState(samplePrompt);

  function submit() {
    if (!prompt.trim()) return;
    if (sessionId) onContinue(prompt);
    else onStartLive(cwd || ".", prompt);
  }

  const activity = buildLiveActivity(events, {
    busy,
    sessionId,
    startedAt: activityStartedAt,
    source: activitySource,
  });

  return (
    <Card className="composer-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{sessionId ? "Continue hosted task" : "Start a hosted Codex task"}</CardTitle>
            <CardDescription className="mt-1">
              Read-only sandbox · genuine App Server events · existing Codex authentication
            </CardDescription>
          </div>
          <span className="live-kicker"><RadioIcon className="size-3" /> JSONL</span>
        </div>
      </CardHeader>
      <CardContent>
        <FieldGroup className="gap-3">
          {!sessionId && (
            <Field>
              <FieldLabel htmlFor="workspace">Workspace</FieldLabel>
              <Input id="workspace" value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="Current repository (.)" />
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="prompt">Instruction</FieldLabel>
            <Textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={submit} disabled={busy || !prompt.trim()}>
              {busy ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
              {sessionId ? "Send turn" : "Start live task"}
            </Button>
            <Button variant="outline" onClick={onReplay} disabled={busy}>
              <PlayIcon data-icon="inline-start" /> Run deterministic replay
            </Button>
          </div>
          <LiveActivity activity={activity} />
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
