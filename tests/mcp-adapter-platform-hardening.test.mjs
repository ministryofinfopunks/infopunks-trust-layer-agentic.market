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
    INFOPUNKS_ENVIRONMENT: "production",
    MCP_ADAPTER_TRANSPORT: "http",
    MCP_ADAPTER_PUBLIC_URL: "https://mcp.infopunks.ai",
    INFOPUNKS_INTERNAL_SERVICE_TOKEN: "prod-token",
    X402_VERIFIER_MODE: "facilitator",
    X402_VERIFIER_URL: "https://verifier.example.com",
    MCP_ADAPTER_ADMIN_TOKEN: "admin-token",
    X402_SETTLEMENT_WEBHOOK_HMAC_SECRET: "whsec",
    MCP_ENTITLEMENT_ISSUER: "agentic.market",
    MCP_ENTITLEMENT_AUDIENCE: "infopunks-mcp",
    MCP_ENTITLEMENT_RS256_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqh...\n-----END PUBLIC KEY-----",
    ...extra
  };
}

test("loadEnv forbids stub verifier mode in non-local by default", () => {
  assert.throws(
    () => withEnv(makeProdOverrides({ X402_VERIFIER_MODE: "stub", X402_ALLOW_STUB_MODE: "false" }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("X402_VERIFIER_MODE=stub")
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
    () => withEnv(makeProdOverrides({ X402_VERIFIER_URL: null }), () => loadEnv()),
    (error) => String(error?.message ?? "").includes("X402_VERIFIER_URL")
  );
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
