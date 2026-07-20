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
      if (!Array.isArray(parsed)) throw new Error("gBox MCP configuration must be a JSON array.");
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
            <CardTitle>Evidence sources</CardTitle>
            <CardDescription className="mt-1">
              gBox routes claims only to MCP tools explicitly marked read-only, or to Codex web search.
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
              <FieldTitle>Use existing Codex MCP configuration</FieldTitle>
              <FieldDescription>
                Include MCP servers and plugin-provided tools already available to this Codex installation.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Use existing Codex MCP configuration"
              checked={useCodexMcpConfig}
              onCheckedChange={setUseCodexMcpConfig}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="web-search-mode">Web-search policy</FieldLabel>
            <select
              id="web-search-mode"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={webSearchMode}
              onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)}
            >
              <option value="disabled">Disabled</option>
              <option value="cached">Cached index</option>
              <option value="live">Live web</option>
            </select>
            <FieldDescription>
              Cached is the safer default. Live results are fresher but increase prompt-injection exposure.
            </FieldDescription>
          </Field>
        </div>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="mcp-config">gBox-specific MCP servers (JSON)</FieldLabel>
          <Textarea
            id="mcp-config"
            className="min-h-44 font-mono text-xs"
            value={serversJson}
            onChange={(event) => setServersJson(event.target.value)}
            spellCheck={false}
            aria-invalid={Boolean(error)}
          />
          <FieldDescription>
            Supports stdio and HTTP transports. Reference secret environment-variable names; never put secret values in this JSON.
          </FieldDescription>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div><Button size="sm" onClick={save} disabled={busy}><SaveIcon data-icon="inline-start" />Save and discover</Button></div>
        </Field>
      </CardContent>
    </Card>
  );
}

function formatServers(servers: ConfiguredMcpServer[]): string {
  return JSON.stringify(servers, null, 2);
}
