# Mid-Session Memory Freshness — 2026-04-23

## Method

Ran `scripts/verify-mid-session-memory.sh` against `https://api.sonz.ai`
with a throwaway test agent. Script:

1. Starts a session
2. Calls `getContext` with query "What kind of coffee do I like?" — records baseline
3. Calls `process` with the fact "I really love Ethiopian pour-over coffee with a medium roast"
4. Waits 2s
5. Calls `getContext` again with the same query, same session
6. Checks whether `loaded_facts` now contains the coffee fact

## Result

> TO FILL IN: paste the script output (/tmp/verify-output.log), especially the jq summaries from steps 2 and 5.

## Verdict

> TO FILL IN: one of:
> - **FRESH** — loaded_facts contained the coffee fact within 2s. No backend work needed.
> - **STALE** — loaded_facts did not contain the coffee fact after 2s. Backend plan required.
> - **PARTIAL** — fact appeared in recent_turns or raw conversation but not in loaded_facts.

## Next

> TO FILL IN based on verdict:
>
> **If FRESH:** Close this investigation. The "memory missing mid-session" symptom likely has a different root cause — instrument the OpenClaw gateway to confirm `assemble()` is firing per turn.
>
> **If STALE:** Open a follow-up plan `<YYYY-MM-DD>-backend-mid-session-memory.md` in sonzai-ai-monolith-ts's plans directory. Scope: dual-write pre-consolidation turns to a short-TTL store (Redis sorted set keyed by agent:user) and expose them in getContext as `recent_turns`. Plugin renders recent_turns as `## Recent Context` section in systemPromptAddition.
>
> **If PARTIAL:** Same as STALE but narrower — backend just needs to surface recent_turns in the context response; no dual-write needed if raw turns are already stored for extraction.
