import { useEffect, useState } from "react";
import { DatabaseIcon, Globe2Icon, SaveIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  ConfiguredMcpServer,
  EvidenceSettings,
  EvidenceSource,
  WebSearchMode,
} from "@/types/gbox";

type Props = {
  settings: EvidenceSettings;
  sources: EvidenceSource[];
  busy: boolean;
  onSave: (settings: EvidenceSettings) => void;
};

export function EvidenceSettingsPanel({ settings, sources, busy, onSave }: Props) {
  const [useCodexMcpConfig, setUseCodexMcpConfig] = useState(settings.useCodexMcpConfig);
  const [webSearchMode, setWebSearchMode] = useState(settings.webSearchMode);
  const [serversJson, setServersJson] = useState(formatServers(settings.mcpServers));
  const [error, setError] = useState<string>();

  useEffect(() => {
    setUseCodexMcpConfig(settings.useCodexMcpConfig);
    setWebSearchMode(settings.webSearchMode);
    setServersJson(formatServers(settings.mcpServers));
  }, [settings]);

  function save() {
    try {
      const parsed = JSON.parse(serversJson) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Additional source connections must be provided as a list.");
      setError(undefined);
      onSave({
        useCodexMcpConfig,
        webSearchMode,
        mcpServers: parsed as ConfiguredMcpServer[],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Sources used for checks</CardTitle>
            <CardDescription className="mt-1">
              Choose where gBox looks for supporting or conflicting evidence.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {sources.slice(0, 6).map((source) => (
              <Badge key={`${source.server ?? "web"}:${source.tool ?? source.title}`} variant="outline">
                {source.sourceKind === "web_search" ? <Globe2Icon /> : <DatabaseIcon />}
                {source.tool ?? source.title}
              </Badge>
            ))}
            {sources.length > 6 && <Badge variant="secondary">+{sources.length - 6}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-4">
          <Field orientation="horizontal" className="consent-field">
            <FieldContent>
              <FieldTitle>Use sources already connected to Codex</FieldTitle>
              <FieldDescription>
                Include trusted sources that are already available in Codex.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Use sources already connected to Codex"
              checked={useCodexMcpConfig}
              onCheckedChange={setUseCodexMcpConfig}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="web-search-mode">Public web sources</FieldLabel>
            <select
              id="web-search-mode"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={webSearchMode}
              onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)}
            >
              <option value="disabled">Off</option>
              <option value="cached">Saved results</option>
              <option value="live">Current web</option>
            </select>
            <FieldDescription>
              Saved results are the safer default. Current web results may be newer but require more caution.
            </FieldDescription>
          </Field>
        </div>
        <details className="rounded-lg border px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Managed source setup</summary>
          <Field data-invalid={Boolean(error)} className="mt-4">
            <FieldLabel htmlFor="mcp-config">Additional source connections</FieldLabel>
            <Textarea
              id="mcp-config"
              className="min-h-44 font-mono text-xs"
              value={serversJson}
              onChange={(event) => setServersJson(event.target.value)}
              spellCheck={false}
              aria-invalid={Boolean(error)}
            />
            <FieldDescription>
              For managed setups. Reference secret environment-variable names and never enter secret values directly.
            </FieldDescription>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div><Button size="sm" onClick={save} disabled={busy}><SaveIcon data-icon="inline-start" />Save sources</Button></div>
          </Field>
        </details>
      </CardContent>
    </Card>
  );
}

function formatServers(servers: ConfiguredMcpServer[]): string {
  return JSON.stringify(servers, null, 2);
}
