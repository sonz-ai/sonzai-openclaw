/**
 * OpenClaw ContextEngine plugin interfaces.
 *
 * Defined locally via structural typing — no OpenClaw import required.
 * OpenClaw uses duck-typing for plugin registration.
 */

// ---------------------------------------------------------------------------
// OpenClaw ContextEngine contract
// ---------------------------------------------------------------------------

export interface ContextEngineInfo {
  id: string;
  name: string;
  ownsCompaction: boolean;
}

export interface MessageItem {
  role: string;
  content: string;
}

export interface MessageOrigin {
  label?: string;
  provider?: string;
  from?: string;
  to?: string;
  accountId?: string;
  threadId?: string;
  senderName?: string;
}

export interface BootstrapArgs {
  sessionId: string;
}

export interface IngestArgs {
  sessionId: string;
  message: MessageItem;
  isHeartbeat: boolean;
  origin?: MessageOrigin;
}

export interface AssembleArgs {
  sessionId: string;
  messages: MessageItem[];
  tokenBudget: number;
  origin?: MessageOrigin;
}

export interface AssembleResult {
  messages: MessageItem[];
  estimatedTokens: number;
  systemPromptAddition?: string;
}

export interface CompactArgs {
  sessionId: string;
  force: boolean;
}

export interface CompactResult {
  ok: boolean;
  compacted: boolean;
}

export interface AfterTurnArgs {
  sessionId: string;
  origin?: MessageOrigin;
}

export interface ContextEngine {
  info: ContextEngineInfo;
  bootstrap(args: BootstrapArgs): Promise<void>;
  ingest(args: IngestArgs): Promise<{ ingested: boolean }>;
  assemble(args: AssembleArgs): Promise<AssembleResult>;
  compact(args: CompactArgs): Promise<CompactResult>;
  afterTurn(args: AfterTurnArgs): Promise<void>;
  dispose(): Promise<void>;
}

export interface PluginAPI {
  registerContextEngine(
    id: string,
    factory: () => ContextEngine,
  ): void;
}

// ---------------------------------------------------------------------------
// Internal session state tracked by the engine
// ---------------------------------------------------------------------------

export interface SessionState {
  agentId: string;
  userId: string;
  sonzaiSessionId: string;
  startedAt: number;
  turnCount: number;
  lastProcessedIndex: number;
  lastMessages: MessageItem[];
}
