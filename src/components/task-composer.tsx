import { useState } from "react";
import { PlayIcon, RadioIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  busy: boolean;
  sessionId?: string;
  onStartLive: (cwd: string, prompt: string) => void;
  onContinue: (prompt: string) => void;
  onReplay: () => void;
};

const samplePrompt = "Check Acme's production database users for 2026-Q2 and prepare a concise report for the gBox test webhook.";

export function TaskComposer({ busy, sessionId, onStartLive, onContinue, onReplay }: Props) {
  const [cwd, setCwd] = useState("");
  const [prompt, setPrompt] = useState(samplePrompt);

  function submit() {
    if (!prompt.trim()) return;
    if (sessionId) onContinue(prompt);
    else onStartLive(cwd || ".", prompt);
  }

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
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
