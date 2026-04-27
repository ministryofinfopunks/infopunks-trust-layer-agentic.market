#!/usr/bin/env node
import { readFileSync } from "node:fs";

const openapiText = readFileSync("openapi.yaml", "utf8");
const httpText = readFileSync("services/mcp-adapter/src/transport/http-server.mjs", "utf8");

const requiredPaths = [
  "/health",
  "/openapi.json",
  "/.well-known/infopunks-trust-layer.json",
  "/v1/resolve-trust"
];
const forbiddenLegacyPaths = [
  "/healthz",
  "/metrics",
  "/x402/reconcile",
  "/x402/settlement/webhook",
  "/war-room",
  "/api/war-room/events"
];

for (const path of requiredPaths) {
  if (!openapiText.includes(path)) {
    console.error(`openapi.yaml missing required path: ${path}`);
    process.exit(1);
  }
  if (!httpText.includes(path)) {
    console.error(`http-server missing required path: ${path}`);
    process.exit(1);
  }
}

for (const path of forbiddenLegacyPaths) {
  if (openapiText.includes(path)) {
    console.error(`openapi.yaml contains forbidden legacy path: ${path}`);
    process.exit(1);
  }
}

if (!openapiText.includes("Payment required")) {
  console.error("openapi.yaml must document 402 Payment required.");
  process.exit(1);
}

console.log("openapi sync ok");
