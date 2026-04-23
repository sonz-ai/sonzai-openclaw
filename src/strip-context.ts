/**
 * Strip our own injected `<sonzai-context>` block from user message
 * content. See CONTEXT_BOUNDARY in context-builder.ts for rationale.
 */

import { CONTEXT_BOUNDARY } from "./context-builder.js";

export function stripInjectedContext(content: string): string {
	if (!content) return content;
	const cut = content.lastIndexOf(CONTEXT_BOUNDARY);
	if (cut < 0) return content;
	return content.slice(cut + CONTEXT_BOUNDARY.length).replace(/^\s+/, "");
}
