#!/usr/bin/env bun
/**
 * Read `spec/openapi.json` and render the subset of endpoints the plugin
 * actually uses into a table between markers in SKILL.md and README.md.
 *
 * Markers:
 *   <!-- api-ref:start -->
 *   <!-- api-ref:end -->
 *
 * Run via `just sync-spec`. Committed output is the table; the spec file
 * is also committed so the render is deterministic for reviewers.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Endpoints the plugin calls. If the SDK layer changes what the plugin
// invokes, update this allow-list.
const PLUGIN_ENDPOINTS: Array<{ method: string; pathPattern: RegExp; label: string }> = [
  { method: "GET",  pathPattern: /^\/health$/, label: "Backend health check (one-shot install probes this)" },
  { method: "POST", pathPattern: /^\/agents$/, label: "Provision / look up agent (idempotent)" },
  { method: "GET",  pathPattern: /^\/agents\/\{[^}]+\}$/, label: "Fetch agent metadata" },
  { method: "PATCH", pathPattern: /^\/agents\/\{[^}]+\}\/capabilities$/, label: "Enforce memoryMode on every bootstrap" },
  { method: "PUT",  pathPattern: /^\/agents\/\{[^}]+\}\/capabilities$/, label: "Enforce memoryMode on every bootstrap" },
  { method: "POST", pathPattern: /^\/agents\/\{[^}]+\}\/context$/, label: "Enriched context for assemble() — per turn" },
  { method: "GET",  pathPattern: /^\/agents\/\{[^}]+\}\/context$/, label: "Enriched context for assemble() — per turn" },
  { method: "POST", pathPattern: /^\/agents\/\{[^}]+\}\/process$/, label: "Fact extraction from afterTurn()" },
  { method: "POST", pathPattern: /^\/agents\/\{[^}]+\}\/memory\/consolidate$/, label: "Consolidation pipeline trigger from compact()" },
  { method: "POST", pathPattern: /^\/agents\/\{[^}]+\}\/sessions\/start$/, label: "Session open — bootstrap()" },
  { method: "POST", pathPattern: /^\/agents\/\{[^}]+\}\/sessions\/end$/, label: "Session close — dispose()" },
];

type OpenAPIOp = { summary?: string; description?: string; operationId?: string };
type OpenAPISpec = {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, OpenAPIOp>>;
};

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const SPEC_PATH = path.join(ROOT, "spec", "openapi.json");

if (!fs.existsSync(SPEC_PATH)) {
  console.error(`error: ${SPEC_PATH} not found. Run \`just sync-spec\` first.`);
  process.exit(1);
}

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf-8")) as OpenAPISpec;
const paths = spec.paths ?? {};

type Match = { method: string; path: string; label: string; summary: string };
const matches: Match[] = [];

for (const [p, ops] of Object.entries(paths)) {
  for (const [method, op] of Object.entries(ops)) {
    const upper = method.toUpperCase();
    for (const candidate of PLUGIN_ENDPOINTS) {
      if (candidate.method === upper && candidate.pathPattern.test(p)) {
        matches.push({
          method: upper,
          path: p,
          label: candidate.label,
          summary: op.summary || op.description || "",
        });
        break;
      }
    }
  }
}

matches.sort((a, b) => {
  if (a.method !== b.method) return a.method.localeCompare(b.method);
  return a.path.localeCompare(b.path);
});

const version = spec.info?.version ?? "(no version in spec)";
const fetchedAt = new Date().toISOString().slice(0, 10);

const table: string[] = [];
table.push(`_Generated from \`spec/openapi.json\` (API version **${version}**, synced ${fetchedAt}) — re-run \`just sync-spec\` to refresh._`);
table.push("");
table.push("| Method | Path | What the plugin uses it for |");
table.push("|--------|------|------------------------------|");
for (const m of matches) {
  table.push(`| \`${m.method}\` | \`${m.path}\` | ${m.label} |`);
}

const rendered = table.join("\n");

for (const file of ["SKILL.md", "README.md"]) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.warn(`warn: ${file} missing, skipping`);
    continue;
  }
  const content = fs.readFileSync(full, "utf-8");
  const startMarker = "<!-- api-ref:start -->";
  const endMarker = "<!-- api-ref:end -->";
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    console.warn(`warn: ${file} has no api-ref markers, skipping`);
    continue;
  }
  const updated =
    content.slice(0, startIdx + startMarker.length) +
    "\n" + rendered + "\n" +
    content.slice(endIdx);
  if (updated !== content) {
    fs.writeFileSync(full, updated);
    console.log(`✓ Updated ${file} (${matches.length} endpoints)`);
  } else {
    console.log(`  ${file} already up-to-date`);
  }
}
