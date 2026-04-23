/**
 * Detect OpenClaw's session-reset boilerplate prompt so we can skip
 * wasted context-engine work on it. Port of the matcher used by the
 * EverOS OpenClaw plugin.
 *
 * Strategy: length check (±20%) to reject cheaply, then normalized
 * Levenshtein distance (<20%) to accept near-matches. OpenClaw can
 * tweak the prompt slightly across releases; an exact match is too
 * brittle.
 */

export const BARE_SESSION_RESET_PROMPT =
	"A new session was started via /new or /reset. Execute your Session Startup sequence now - read the required files before responding to the user. Then greet the user in your configured persona, if one is provided. Be yourself - use your defined voice, mannerisms, and mood. Keep it to 1-3 sentences and ask what they want to do. If the runtime model differs from default_model in the system prompt, mention the default model. Do not mention internal steps, files, tools, or reasoning.";

function levenshtein(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
	let curr: number[] = new Array<number>(n + 1).fill(0);
	for (let i = 1; i <= m; i++) {
		curr[0] = i;
		for (let j = 1; j <= n; j++) {
			const diag = prev[j - 1] as number;
			const up = prev[j] as number;
			const left = curr[j - 1] as number;
			curr[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, up, left);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[n] as number;
}

/**
 * Returns true when `query` is within 20% length of the canonical prompt
 * AND its normalized edit distance is below 0.20 (≥80% similar).
 */
export function isSessionResetPrompt(query: string | undefined): boolean {
	if (!query) return false;
	const promptLen = BARE_SESSION_RESET_PROMPT.length;
	const queryLen = query.length;
	if (Math.abs(queryLen - promptLen) / promptLen > 0.2) return false;
	const dist = levenshtein(query, BARE_SESSION_RESET_PROMPT);
	return dist / Math.max(queryLen, promptLen) < 0.2;
}
