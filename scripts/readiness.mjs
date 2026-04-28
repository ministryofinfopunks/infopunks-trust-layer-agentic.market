#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { loadEnv } from "../services/mcp-adapter/src/config/env.mjs";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function read(path) {
  return readFileSync(path, "utf8");
}

async function liveCheck(baseUrl) {
const checks = [
    ["health", "/health"],
    ["manifest", "/.well-known/infopunks-trust-layer.json"],
    ["openapi", "/openapi.json"],
    ["events", "/v1/events/recent"]
  ];
  for (const [name, route] of checks) {
    const response = await fetch(`${baseUrl}${route}`);
    if (!response.ok) {
      fail(`live ${name} returned ${response.status}`);
    } else {
      pass(`live ${name} is public`);
    }
  }
}

const httpServer = read("services/mcp-adapter/src/transport/http-server.mjs");
const render = read("render.yaml");
const env = read("services/mcp-adapter/src/config/env.mjs");

const requiredRoutes = ["/health", "/openapi.json", "/.well-known/infopunks-trust-layer.json", "/v1/resolve-trust", "/v1/events/recent"];
for (const route of requiredRoutes) {
  if (httpServer.includes(route)) {
    pass(`route present ${route}`);
  } else {
    fail(`missing route ${route}`);
  }
}

const forbiddenPublicRoutes = ["/trust-score", "/mcp", "/agent-reputation/", "/verify-evidence", "/.well-known/x402-bazaar.json", "/.well-known/agentic-marketplace.json", "/marketplace/readiness"];
for (const route of forbiddenPublicRoutes) {
  if (httpServer.includes(route)) {
    fail(`stale public route remains ${route}`);
  } else {
    pass(`stale public route absent ${route}`);
  }
}

if (render.includes("X402_NETWORK") && render.includes("value: base") && render.includes("eip155:8453")) {
  pass("render production network is Base mainnet");
} else {
  fail("render production network is not clearly Base mainnet");
}

if (render.includes("ALLOW_TESTNET") && render.includes('value: "false"') && render.includes("ALLOW_RELAXED_PAYMENT")) {
  pass("render disables testnet/relaxed payment for production");
} else {
  fail("render does not disable testnet/relaxed payment");
}

if (env.includes("NODE_ENV=production") && env.includes("ALLOW_RELAXED_PAYMENT=false") && env.includes("X402_NETWORK=base")) {
  pass("production env validation markers present");
} else {
  fail("production env validation markers missing");
}

if (env.includes("X402_FACILITATOR_PROVIDER") && env.includes("openfacilitator") && env.includes("cdp")) {
  pass("facilitator provider selector supports openfacilitator and cdp");
} else {
  fail("facilitator provider selector markers missing");
}

if (
  env.includes("https://api.cdp.coinbase.com/platform/v2/x402")
  && env.includes("CDP_API_KEY_ID")
  && env.includes("CDP_API_KEY_SECRET")
) {
  pass("CDP facilitator validation markers present");
} else {
  fail("CDP facilitator validation markers missing");
}

try {
  const config = loadEnv();
  pass(`current env validates for ${config.x402FacilitatorProvider} facilitator provider`);
} catch (error) {
  fail(`current env validation failed: ${error?.message ?? error}`);
}

const publicBaseUrl = String(process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
if (publicBaseUrl) {
  await liveCheck(publicBaseUrl);
} else {
  console.log("SKIP live readiness: PUBLIC_BASE_URL is not set");
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
