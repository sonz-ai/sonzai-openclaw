#!/usr/bin/env bash
#
# Reproducible check of whether Sonzai's getContext endpoint returns
# facts that were just ingested via agents.process in the same session.
#
# Usage:
#   export SONZAI_API_KEY=sk-...
#   export SONZAI_AGENT_ID=<existing-test-agent-uuid>
#   export SONZAI_USER_ID=verify-user-$(date +%s)
#   ./scripts/verify-mid-session-memory.sh
#
# Exit 0 = memory is fresh mid-session (no backend work needed).
# Exit 1 = stale — triggers the follow-up backend plan.

set -euo pipefail

: "${SONZAI_API_KEY:?set SONZAI_API_KEY}"
: "${SONZAI_AGENT_ID:?set SONZAI_AGENT_ID}"
USER_ID="${SONZAI_USER_ID:-verify-user-$(date +%s)}"
BASE="${SONZAI_BASE_URL:-https://api.sonz.ai}"
SESSION_ID="verify-$(date +%s)"
QUERY="What kind of coffee do I like?"
FACT="I really love Ethiopian pour-over coffee with a medium roast."

auth=(-H "Authorization: Bearer ${SONZAI_API_KEY}" -H "Content-Type: application/json")

echo "== 1. Start session =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/sessions/start" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\"}" \
  | jq -c . || true

echo "== 2. Baseline getContext BEFORE ingestion =="
before=$(curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/context" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"query\":\"${QUERY}\"}")
echo "$before" | jq '{loaded_facts: (.loaded_facts // [] | length), recent_turns: (.recent_turns // [] | length)}'

echo "== 3. Process (ingest) a turn with the fact =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/process" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"messages\":[{\"role\":\"user\",\"content\":\"${FACT}\"},{\"role\":\"assistant\",\"content\":\"Noted — Ethiopian pour-over, medium roast.\"}]}" \
  | jq -c . || true

echo "== 4. Wait 2s for extraction =="
sleep 2

echo "== 5. getContext AFTER ingestion, same query =="
after=$(curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/context" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"query\":\"${QUERY}\"}")
echo "$after" | jq '{loaded_facts: (.loaded_facts // [] | map(.atomic_text // .content)), recent_turns: (.recent_turns // [] | length)}'

echo "== 6. End session =="
curl -sf "${auth[@]}" -X POST \
  "${BASE}/v1/agents/${SONZAI_AGENT_ID}/sessions/end" \
  -d "{\"user_id\":\"${USER_ID}\",\"session_id\":\"${SESSION_ID}\",\"total_messages\":2,\"duration_seconds\":5}" \
  | jq -c . || true

echo
if echo "$after" | jq -e '(.loaded_facts // []) | map(.atomic_text // .content // "") | any(ascii_downcase | test("pour.?over|ethiopian|coffee"))' > /dev/null; then
  echo "RESULT: FRESH — mid-session memory works. No backend work needed."
  exit 0
else
  echo "RESULT: STALE — fact not retrievable same-session. Backend plan required."
  exit 1
fi
