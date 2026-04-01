/**
 * Extracts user identity from OpenClaw session keys.
 *
 * Session key formats:
 *   CLI 1:1     — agent:<agentId>:<mainKey>
 *   DM          — agent:<agentId>:<channel>:direct:<peerId>
 *   Group       — agent:<agentId>:<channel>:group:<groupId>
 *   Cron        — cron:<jobId>
 *   Webhook     — hook:<uuid>
 */

export interface ParsedSessionKey {
  /** The agentId segment from the session key (may differ from configured agentId). */
  agentId: string | null;
  /** Resolved userId for Sonzai SDK calls. */
  userId: string;
  /** Channel identifier (e.g. "telegram", "discord"), if present. */
  channel: string | null;
  /** How this session was identified. */
  sessionType: "cli" | "dm" | "group" | "cron" | "webhook" | "unknown";
}

export function parseSessionKey(
  sessionId: string,
  defaultUserId: string,
): ParsedSessionKey {
  const parts = sessionId.split(":");

  // agent:<agentId>:...
  if (parts[0] === "agent" && parts.length >= 3) {
    const agentId = parts[1] ?? null;

    // agent:<agentId>:<channel>:direct:<peerId...>
    const directIdx = parts.indexOf("direct");
    if (directIdx !== -1 && directIdx + 1 < parts.length) {
      const channel = directIdx >= 3 ? parts[2]! : null;
      // peerId may itself contain colons (e.g. "telegram:123"), rejoin everything after "direct:"
      const peerId = parts.slice(directIdx + 1).join(":");
      return {
        agentId,
        userId: peerId,
        channel,
        sessionType: "dm",
      };
    }

    // agent:<agentId>:<channel>:group:<groupId...>
    const groupIdx = parts.indexOf("group");
    if (groupIdx !== -1 && groupIdx + 1 < parts.length) {
      const channel = groupIdx >= 3 ? parts[2]! : null;
      const groupId = parts.slice(groupIdx + 1).join(":");
      return {
        agentId,
        userId: groupId,
        channel,
        sessionType: "group",
      };
    }

    // agent:<agentId>:<mainKey> — CLI / 1:1
    return {
      agentId,
      userId: defaultUserId,
      channel: null,
      sessionType: "cli",
    };
  }

  // cron:<jobId>
  if (parts[0] === "cron") {
    return {
      agentId: null,
      userId: defaultUserId,
      channel: null,
      sessionType: "cron",
    };
  }

  // hook:<uuid>
  if (parts[0] === "hook") {
    return {
      agentId: null,
      userId: defaultUserId,
      channel: null,
      sessionType: "webhook",
    };
  }

  // Unrecognized format
  return {
    agentId: null,
    userId: defaultUserId,
    channel: null,
    sessionType: "unknown",
  };
}
