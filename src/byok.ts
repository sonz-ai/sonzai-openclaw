/**
 * BYOK (bring-your-own-key) bootstrap.
 *
 * On plugin load, if the resolved config has any provider keys under
 * `byok`, register them with the Sonzai platform via PUT
 * /api/v1/projects/{projectId}/byok-keys/{provider}. The platform then
 * uses the customer's key for upstream LLM calls and bills only the 25%
 * service fee (vs 125% platform-key markup).
 *
 * Registration is idempotent on the platform side (PUT semantics), so
 * running this on every plugin load is safe — the only cost is one
 * network round-trip per provider per startup.
 */

import type { Sonzai } from "@sonzai-labs/agents";
import type { ByokProvider, ResolvedConfig } from "./config.js";

const TAG = "[@sonzai-labs/openclaw-context][byok]";

/**
 * Register configured BYOK keys against the Sonzai platform.
 * Returns the set of providers that registered successfully.
 *
 * Resolution order for projectId:
 *   1. config.projectId
 *   2. Auto-discovery: tenant's project named "Default" via projects.list()
 *
 * On any failure the function logs and returns — never throws.
 */
export async function registerByokKeys(
  client: Sonzai,
  config: ResolvedConfig,
): Promise<ByokProvider[]> {
  const providers = Object.keys(config.byok) as ByokProvider[];
  if (providers.length === 0) return [];

  let projectId: string;
  try {
    projectId = await resolveProjectId(client, config);
  } catch (err) {
    console.warn(
      `${TAG} skipping BYOK registration — could not resolve projectId: ${formatErr(err)}. ` +
        `Set SONZAI_PROJECT_ID or add projectId to openclaw.json.`,
    );
    return [];
  }

  const results = await Promise.allSettled(
    providers.map((provider) =>
      client.byok.set(projectId, provider, config.byok[provider] as string),
    ),
  );

  const registered: ByokProvider[] = [];
  results.forEach((r, i) => {
    const provider = providers[i] as ByokProvider;
    if (r.status === "fulfilled") {
      registered.push(provider);
      console.log(`${TAG} registered ${provider} key on project ${projectId}`);
    } else {
      console.warn(
        `${TAG} failed to register ${provider} key on project ${projectId}: ${formatErr(r.reason)}`,
      );
    }
  });
  return registered;
}

async function resolveProjectId(
  client: Sonzai,
  config: ResolvedConfig,
): Promise<string> {
  if (config.projectId) return config.projectId;

  const list = await client.projects.list({ pageSize: 100 });
  const projects = list.items ?? [];
  const def = projects.find((p) => p.name === "Default");
  if (def) return def.project_id;

  // Single-project tenants don't need a "Default" — use it directly.
  if (projects.length === 1 && projects[0]) return projects[0].project_id;

  throw new Error(
    projects.length === 0
      ? "no projects visible to this API key"
      : `${projects.length} projects visible and none is named "Default"`,
  );
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
