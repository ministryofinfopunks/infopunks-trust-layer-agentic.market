import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { createHttpTransport } from "../services/mcp-adapter/src/transport/http-server.mjs";

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

test("/health is unconditional and does not depend on upstream readiness", async () => {
  let upstreamHealthCalls = 0;
  const port = await getFreePort();

  const transport = createHttpTransport({
    config: {
      host: "127.0.0.1",
      port,
      publicUrl: null,
      adapterName: "infopunks-test-adapter",
      adapterVersion: "test",
      x402VerifierMode: "facilitator",
      settlementWebhookHmacSecret: "whsec",
      settlementWebhookSecret: null,
      adminEndpointsRequireToken: true,
      adminToken: "admin-token",
      entitlementTokenRequired: true,
      entitlementIssuer: "issuer",
      entitlementAudience: "aud",
      metricsPublic: false,
      environment: "test",
      maxBatchRequests: 25
    },
    mcpServer: {
      apiClient: {
        health: async () => {
          upstreamHealthCalls += 1;
          return false;
        }
      },
      entitlementService: {
        verifier: {
          readiness: async () => ({ connected: false, reason: "offline" })
        }
      },
      reconciliationService: {
        applySettlementEvent: async () => ({ ok: true }),
        reconcileOnce: async () => ({ ok: true })
      },
      handleRequest: async () => ({ jsonrpc: "2.0", id: "1", result: {} }),
      executeTool: async () => ({})
    },
    logger: { info() {}, error() {} },
    metrics: { snapshot() { return {}; } }
  });

  await transport.listen();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { status: "ok" });
    assert.equal(upstreamHealthCalls, 0);

    const readiness = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(readiness.status, 503);
    assert.ok(upstreamHealthCalls >= 1);

    const trustLayer = await fetch(`http://127.0.0.1:${port}/.well-known/infopunks-trust-layer.json`);
    assert.equal(trustLayer.status, 200);
    const trustLayerBody = await trustLayer.json();
    assert.equal(trustLayerBody.endpoints.resolve_trust.endsWith("/v1/resolve-trust"), true);

    const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    assert.equal(openapi.status, 200);
    const openapiBody = await openapi.json();
    assert.ok(openapiBody.paths["/v1/resolve-trust"]);
  } finally {
    await transport.close();
  }
});
