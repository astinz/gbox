export type ClaimState = "Verified" | "Contradicted" | "Unverifiable";
export type ActionState =
  | "Pending"
  | "Approved"
  | "Denied"
  | "Executed"
  | "Failed"
  | "Expired";

export type Claim = {
  id: string;
  sessionId: string;
  turnId?: string;
  statement: string;
  claimType: string;
  subject?: string;
  predicate?: string;
  object?: string;
  assertedValue?: string;
  unit?: string;
  temporalContext?: string;
  location?: string;
  sourceSpan: string;
  state: ClaimState;
  confidence: number;
  createdAt: string;
};

export type Evidence = {
  id: string;
  claimId: string;
  sourceKind: string;
  sourceName: string;
  sourceReference: string;
  content?: unknown;
  resultHash: string;
  explanation: string;
  createdAt: string;
};

export type PendingAction = {
  id: string;
  sessionId: string;
  turnId?: string;
  toolUseId?: string;
  actionType: string;
  reportMarkdown: string;
  payloadHash: string;
  state: ActionState;
  claimIds: string[];
  requestedAt: string;
  decidedAt?: string;
  executedAt?: string;
};

export type Decision = {
  id: string;
  actionId: string;
  decision: string;
  reason?: string;
  decidedBy: string;
  decidedAt: string;
};

export type Receipt = {
  id: string;
  sequence: number;
  eventType: string;
  entityId: string;
  payload: unknown;
  previousHash: string;
  hash: string;
  createdAt: string;
};

export type CodexEvent = {
  id: string;
  sessionId?: string;
  method: string;
  summary: string;
  payload: unknown;
  source: string;
  createdAt: string;
};

export type SystemStatus = {
  codexFound: boolean;
  codexPath?: string;
  codexVersion?: string;
  codexSupported: boolean;
  appServerConnected: boolean;
  pluginInstalled: boolean;
  hooksTrusted: boolean;
  evidenceSourcesReady: boolean;
  evidenceSourceCount: number;
  globalObservation: boolean;
  receiptChainValid: boolean;
  replayMode: boolean;
  diagnostic?: string;
};

export type DashboardSnapshot = {
  status: SystemStatus;
  claims: Claim[];
  evidence: Evidence[];
  actions: PendingAction[];
  decisions: Decision[];
  receipts: Receipt[];
  events: CodexEvent[];
  evidenceSettings: EvidenceSettings;
};

export type WebSearchMode = "disabled" | "cached" | "live";

export type ConfiguredMcpServer = {
  name: string;
  enabled: boolean;
} & (
  | {
      transport: "stdio";
      command: string;
      args: string[];
      cwd?: string;
      envVars: string[];
    }
  | {
      transport: "http";
      url: string;
      bearerTokenEnvVar?: string;
    }
);

export type EvidenceSettings = {
  useCodexMcpConfig: boolean;
  webSearchMode: WebSearchMode;
  mcpServers: ConfiguredMcpServer[];
};

export const emptySnapshot: DashboardSnapshot = {
  status: {
    codexFound: false,
    codexSupported: false,
    appServerConnected: false,
    pluginInstalled: false,
    hooksTrusted: false,
    evidenceSourcesReady: false,
    evidenceSourceCount: 0,
    globalObservation: false,
    receiptChainValid: true,
    replayMode: false,
  },
  claims: [],
  evidence: [],
  actions: [],
  decisions: [],
  receipts: [],
  events: [],
  evidenceSettings: {
    useCodexMcpConfig: true,
    webSearchMode: "cached",
    mcpServers: [],
  },
};
