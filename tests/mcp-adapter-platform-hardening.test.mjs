import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";

import { loadEnv } from "../services/mcp-adapter/src/config/env.mjs";
import { PassportMapper } from "../services/mcp-adapter/src/identity/passport-mapper.mjs";
import { FileIdentityMappingStore } from "../services/mcp-adapter/src/identity/mapping-store.mjs";
import { AdapterRateLimiter } from "../services/mcp-adapter/src/middleware/rate-limit.mjs";
import { MemoryRateLimitStrategy } from "../services/mcp-adapter/src/middleware/rate-limit-strategy.mjs";

function withEnv(overrides, fn) {
  const snapshot = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    snapshot.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of snapshot.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function makeProdOverrides(extra = {}) {
  return {
    NODE_ENV: "production",
    INFOPUNKS_ENVIRONMENT: "production",
    MCP_ADAPTER_TRANSPORT: "http",
    PUBLIC_BASE_URL: "https://mcp.infopunks.ai",
    MCP_ADAPTER_PUBLIC_URL: "https://mcp.infopunks.ai",
    INFOPUNKS_CORE_BASE_URL: "https://infopunks-core-api.onrender.com",
    INFOPUNKS_INTERNAL_SERVICE_TOKEN: "prod-token",
    X402_VERIFIER_MODE: "facilitator",
    X402_VERIFIER_URL: "https://verifier.example.com",
    X402_FACILITATOR_URL: "https://verifier.example.com",
    X402_NETWORK: "base",
    X402_ASSET: "USDC",
    X402_PRICE_USD: "0.01",
    X402_PAYMENT_ASSET_ADDRESS: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
    X402_PAY_TO: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    ALLOW_TESTNET: "false",
    ALLOW_RELAXED_PAYMENT: "false",
    MCP_ADAPTER_ADMIN_TOKEN: "admin-token",
    X402_SETTLEMENT_WEBHOOK_HMAC_SECRET: "whsec",
    MCP_ENTITLEMENT_ISSUER: "agentic.market",
    MCP_ENTITLEMENT_AUDIENCE: "infopunks-mcp",
    MCP_ENTITLEMENT_RS256_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...\n-----END PUBLIC KEY-----",
    ...extra
  };
}

test("loadEnv rejects non-facilitator verifier mode", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ X402_VERIFIER_MODE: "stub", X402_ALLOW_STUB_MODE: "false" }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("X402_VERIFIER_MODE must be facilitator")
  );
});

test("loadEnv requires admin token in non-local HTTP mode", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ MCP_ADAPTER_ADMIN_TOKEN: null }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("MCP_ADAPTER_ADMIN_TOKEN")
  );
});

test("loadEnv requires webhook auth in non-local HTTP mode", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ X402_SETTLEMENT_WEBHOOK_HMAC_SECRET: null, X402_SETTLEMENT_WEBHOOK_SECRET: null }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("Webhook auth is required")
  );
});

test("loadEnv requires verifier URL when facilitator mode is enabled", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ X402_VERIFIER_URL: "", X402_FACILITATOR_URL: "" }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("X402_VERIFIER_URL")
  );
});

test("loadEnv blocks Base Sepolia/testnet markers in NODE_ENV production", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({
      X402_NETWORK: "base-sepolia",
      X402_PAYMENT_ASSET_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("X402_NETWORK=base")
  );
});

test("loadEnv requires production public HTTPS URL and relaxed payment disabled", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({
      PUBLIC_BASE_URL: "http://localhost:4021",
      ALLOW_RELAXED_PAYMENT: "true"
    }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("cannot point to localhost/loopback")
  );
});

test("loadEnv rejects localhost public URL in non-local testnet deployments", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({
      NODE_ENV: "test",
      INFOPUNKS_ENVIRONMENT: "testnet",
      PUBLIC_BASE_URL: "http://localhost:4021",
      MCP_ADAPTER_PUBLIC_URL: null,
      X402_NETWORK: "base-sepolia",
      X402_PAYMENT_ASSET_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      ALLOW_TESTNET: "true"
    }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("cannot point to localhost/loopback")
  );
});

test("loadEnv allows Base Sepolia for non-local testnet deployments", () => {
  const config = withEnv(
    makeProdOverrides({
      NODE_ENV: "test",
      INFOPUNKS_ENVIRONMENT: "testnet",
      PUBLIC_BASE_URL: "https://mcp-testnet.infopunks.ai",
      MCP_ADAPTER_PUBLIC_URL: null,
      X402_NETWORK: "base-sepolia",
      X402_PAYMENT_ASSET_ADDRESS: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      ALLOW_TESTNET: "true"
    }),
    () => loadEnv()
  );

  assert.equal(config.x402SupportedNetworks[0], "eip155:84532");
  assert.equal(config.x402VerifierMode, "facilitator");
});

test("loadEnv accepts MCP_ADAPTER_PUBLIC_URL when PUBLIC_BASE_URL is empty", () => {
  const config = withEnv(
    makeProdOverrides({
      PUBLIC_BASE_URL: "",
      MCP_ADAPTER_PUBLIC_URL: "https://mcp.infopunks.ai"
    }),
    () => loadEnv()
  );

  assert.equal(config.publicUrl, "https://mcp.infopunks.ai");
});

test("loadEnv rejects unsafe backend drivers in multi-instance mode", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ MCP_ADAPTER_MULTI_INSTANCE_MODE: "true" }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("STATE_STORE_DRIVER=postgres")
  );
});

test("loadEnv requires postgres URLs when postgres drivers are selected", () => {
  assert.throws(
    () =>
      withEnv(
        makeProdOverrides({
          MCP_ADAPTER_STATE_STORE_DRIVER: "postgres",
          MCP_ADAPTER_STATE_STORE_DATABASE_URL: null
        }),
        () => loadEnv()
      ),
    (error) => String(error?.message ?? "").includes("MCP_ADAPTER_STATE_STORE_DATABASE_URL")
  );
});

test("file-backed identity mapping store is deterministic and persistent", async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-adapter-mapping-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const mapPath = path.join(dir, "external_identity_mappings.json");
  const store = new FileIdentityMappingStore({ filePath: mapPath });
  const mapper = new PassportMapper({ mapPath, environment: "test", store });

  const identity = mapper.normalizeIdentity({ agent_id: "Agent-123", did: "did:key:test", wallet: "0xabc" });
  assert.ok(identity);

  const firstSubject = await mapper.ensureInternalSubject(identity);
  assert.ok(firstSubject.startsWith("agent_"));

  const secondSubject = await mapper.ensureInternalSubject(identity);
  assert.equal(secondSubject, firstSubject);
  assert.equal(await mapper.lookupInternalSubject(identity.external_id), firstSubject);
});

test("rate limiter strategy boundary preserves behavior", async () => {
  const limiter = new AdapterRateLimiter(2, new MemoryRateLimitStrategy({ maxTrackedKeys: 1000 }));
  await limiter.hit("ip:payer:agent");
  await limiter.hit("ip:payer:agent");
  await assert.rejects(
    () => limiter.hit("ip:payer:agent"),
    (error) => error?.code === "ENTITLEMENT_REQUIRED"
  );
});
