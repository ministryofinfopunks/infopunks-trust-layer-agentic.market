import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routesPath = path.join(root, "apps", "api", "lib", "routes.mjs");
const specPath = path.join(root, "openapi.yaml");

const routesBody = readFileSync(routesPath, "utf8");
const specBody = readFileSync(specPath, "utf8");

const routePaths = [...routesBody.matchAll(/path:\s*"([^"]+)"/g)]
  .map((match) => match[1])
  .filter((routePath) => routePath.startsWith("/v1/"))
  .map((routePath) => routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}"));

for (const routePath of routePaths) {
  if (!specBody.includes(`${routePath}:`)) {
    console.error(`speccheck failed: missing path ${routePath} in ${specPath}`);
    process.exit(1);
  }
}

for (const schemaName of ["PromptPack", "TraceReplayBundle", "TrustExplainResponse", "WarRoomState", "ErrorEnvelope"]) {
  if (!specBody.includes(`${schemaName}:`)) {
    console.error(`speccheck failed: missing schema ${schemaName} in ${specPath}`);
    process.exit(1);
  }
}

for (const scopeMarker of ["x-infopunks-required-scope: read", "x-infopunks-required-scope: write"]) {
  if (!specBody.includes(scopeMarker)) {
    console.error(`speccheck failed: missing required scope marker "${scopeMarker}" in ${specPath}`);
    process.exit(1);
  }
}

console.log(`speccheck ok: ${routePaths.length} routed API paths covered by openapi.yaml`);
