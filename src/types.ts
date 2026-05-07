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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: { type: string; text: string }[];
}

export interface PluginAPI {
  registerContextEngine(
    id: string,
    factory: () => ContextEngine,
  ): void;
  registerTool?(
    definition: ToolDefinition,
    flags?: { optional?: boolean },
  ): void;
}

// ---------------------------------------------------------------------------
// Internal session state tracked by the engine
// ---------------------------------------------------------------------------

// Imported lazily via type-only import below to avoid pulling the SDK at
// runtime when the plugin's types are imported (e.g. in OpenClaw's plugin
// loader). The handle drives the per-turn loop: .context() before each turn,
// .turn() after each turn, .end() on dispose.
import type { Session } from "@sonzai-labs/agents";

export interface SessionState {
  /** Bound Sonzai session handle — context()/turn()/end() pre-fill identity. */
  handle: Session;
  agentId: string;
  userId: string;
  sonzaiSessionId: string;
  startedAt: number;
  turnCount: number;
  lastProcessedIndex: number;
  lastMessages: MessageItem[];
}
