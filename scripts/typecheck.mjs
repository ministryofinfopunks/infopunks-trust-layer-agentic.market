import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declarationPath = path.join(root, "packages", "trust-sdk", "index.d.ts");
const body = readFileSync(declarationPath, "utf8");

const forbiddenTokens = ["Promise<any>", ": any", "<any>"];
for (const token of forbiddenTokens) {
  if (body.includes(token)) {
    console.error(`typecheck failed: found forbidden token "${token}" in ${declarationPath}`);
    process.exit(1);
  }
}

const requiredExports = [
  "InfopunksApiError",
  "Passport",
  "DisputeEvaluation",
  "TrustResolution",
  "RoutingDecision",
  "PromptPack",
  "TraceReplayBundle",
  "TrustExplainResponse"
];

for (const exportName of requiredExports) {
  if (
    !body.includes(`export interface ${exportName}`) &&
    !body.includes(`export type ${exportName}`) &&
    !body.includes(`export declare class ${exportName}`)
  ) {
    console.error(`typecheck failed: missing exported type ${exportName}`);
    process.exit(1);
  }
}

console.log("typecheck ok: trust-sdk declarations are concrete");
