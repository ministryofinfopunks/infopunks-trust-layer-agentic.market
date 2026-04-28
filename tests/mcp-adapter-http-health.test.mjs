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
      x402FacilitatorProvider: "openfacilitator",
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      x402PayTo: "0x1111111111111111111111111111111111111111",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300,
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

    const trustLayer = await fetch(`http://127.0.0.1:${port}/.well-known/infopunks-trust-layer.json`);
    assert.equal(trustLayer.status, 200);
    const trustLayerBody = await trustLayer.json();
    assert.equal(trustLayerBody.endpoints.resolve_trust.endsWith("/v1/resolve-trust"), true);
    assert.equal(upstreamHealthCalls, 0);

    const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    assert.equal(openapi.status, 200);
    const openapiBody = await openapi.json();
    assert.ok(openapiBody.paths["/v1/resolve-trust"]);
    assert.ok(openapiBody.paths["/v1/events/recent"]);

    const events = await fetch(`http://127.0.0.1:${port}/v1/events/recent`);
    assert.equal(events.status, 200);
    const eventsBody = await events.json();
    assert.deepEqual(eventsBody, { count: 0, events: [] });

    const unpaidEmpty = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, { method: "POST" });
    assert.equal(unpaidEmpty.status, 402);
    const challenge = unpaidEmpty.headers.get("payment-required");
    assert.equal(typeof challenge, "string");
    const unpaidInvalidBody = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(unpaidInvalidBody.status, 402);
    const paidLegacyHeader = Buffer.from(JSON.stringify({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        amount: "10000",
        asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        payTo: "0x1111111111111111111111111111111111111111",
        maxTimeoutSeconds: 300
      },
      payload: {
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          nonce: "0xnonce_open_legacy"
        }
      }
    }), "utf8").toString("base64");
    const openPaidLegacy = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": paidLegacyHeader
      },
      body: JSON.stringify({
        subject_id: "agent_open_legacy_header",
        context: { task_type: "marketplace_routing", domain: "general", risk_level: "medium" }
      })
    });
    assert.equal(openPaidLegacy.status, 200);

    const legacyRoutes = ["/metrics", "/x402/reconcile", "/x402/settlement/webhook", "/api/war-room/events"];
    for (const route of legacyRoutes) {
      const legacyResponse = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(legacyResponse.status, 404);
    }
  } finally {
    await transport.close();
  }
});

test("/v1/resolve-trust in cdp mode accepts PAYMENT-SIGNATURE v2 header", async () => {
  const port = await getFreePort();
  let capturedPayment = null;

  const transport = createHttpTransport({
    config: {
      host: "127.0.0.1",
      port,
      publicUrl: null,
      adapterName: "infopunks-test-adapter",
      adapterVersion: "test",
      x402VerifierMode: "facilitator",
      x402FacilitatorProvider: "cdp",
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:8453"],
      x402PaymentScheme: "exact",
      x402PaymentAssetAddress: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
      x402PayTo: "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3",
      x402PricePerUnitAtomic: "10000",
      x402PaymentTimeoutSeconds: 300,
      x402PriceUsd: "0.01",
      x402Eip712Name: "USD Coin",
      x402Eip712Version: "2",
      settlementWebhookHmacSecret: "whsec",
      settlementWebhookSecret: null,
      adminEndpointsRequireToken: true,
      adminToken: "admin-token",
      entitlementTokenRequired: false,
      metricsPublic: false,
      environment: "test",
      maxBatchRequests: 25
    },
    mcpServer: {
      apiClient: { health: async () => true },
      entitlementService: {
        verifier: {
          readiness: async () => ({ connected: true, reason: "ok" })
        }
      },
      reconciliationService: {
        applySettlementEvent: async () => ({ ok: true }),
        reconcileOnce: async () => ({ ok: true })
      },
      handleRequest: async () => ({ jsonrpc: "2.0", id: "1", result: {} }),
      executeTool: async (_toolDef, args) => {
        capturedPayment = args?.payment ?? null;
        return {
          result: {
            subject_id: args.subject_id,
            score: 77,
            band: "watch",
            confidence: 0.84,
            decision: "allow",
            reason_codes: ["smoke_verified"]
          },
          meta: {
            billed_units: 1,
            payment_receipt_id: "xrc_test_payment_signature",
            x402_receipt: {
              facilitator_provider: "cdp",
              network: "eip155:8453",
              asset: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
              payTo: "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3",
              price: "10000"
            }
          }
        };
      }
    },
    logger: { info() {}, error() {} },
    metrics: { snapshot() { return {}; } }
  });

  await transport.listen();
  try {
    const trustLayer = await fetch(`http://127.0.0.1:${port}/.well-known/infopunks-trust-layer.json`);
    assert.equal(trustLayer.status, 200);
    const trustLayerBody = await trustLayer.json();
    assert.equal(trustLayerBody?.payment?.price, "$0.01");
    assert.equal(trustLayerBody?.payment?.price_atomic, "10000");
    assert.equal(trustLayerBody?.resources?.resolve_trust?.method, "POST");
    assert.equal(
      trustLayerBody?.resources?.resolve_trust?.resource,
      `http://127.0.0.1:${port}/v1/resolve-trust`
    );
    assert.equal(trustLayerBody?.resources?.resolve_trust?.url.endsWith("/v1/resolve-trust"), true);
    assert.equal(trustLayerBody?.resources?.resolve_trust?.description.includes("machine-readable risk context"), true);
    assert.equal(trustLayerBody?.resources?.resolve_trust?.mimeType, "application/json");
    assert.deepEqual(
      Object.keys(trustLayerBody?.resources?.resolve_trust?.extensions?.bazaar ?? {}).sort(),
      ["info", "schema"]
    );
    assert.deepEqual(
      trustLayerBody?.resources?.resolve_trust?.outputSchema?.required,
      ["subject_id", "trust_score", "route"]
    );

    const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`);
    assert.equal(openapi.status, 200);
    const openapiBody = await openapi.json();
    assert.equal(openapiBody?.paths?.["/v1/resolve-trust"]?.post?.description.includes("machine-readable risk context"), true);
    assert.deepEqual(
      Object.keys(openapiBody?.paths?.["/v1/resolve-trust"]?.post?.extensions?.bazaar ?? {}).sort(),
      ["info", "schema"]
    );

    const unpaidEmpty = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, { method: "POST" });
    assert.equal(unpaidEmpty.status, 402);
    const challengeRaw = unpaidEmpty.headers.get("payment-required");
    assert.equal(typeof challengeRaw, "string");
    const challenge = JSON.parse(Buffer.from(challengeRaw, "base64").toString("utf8"));
    assert.equal(challenge.x402Version, 2);
    assert.equal(challenge.accepts?.[0]?.scheme, "exact");
    assert.equal(challenge.accepts?.[0]?.network, "eip155:8453");
    assert.equal(challenge.accepts?.[0]?.amount, "10000");
    assert.equal(challenge.accepts?.[0]?.asset, "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913");
    assert.equal(challenge.accepts?.[0]?.payTo, "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3");
    assert.equal(challenge.accepts?.[0]?.extra?.name, "USD Coin");
    assert.equal(challenge.accepts?.[0]?.extra?.version, "2");
    assert.equal(challenge.accepts?.[0]?.extra?.symbol, "USDC");
    assert.equal(challenge.resource?.resource, `http://127.0.0.1:${port}/v1/resolve-trust`);
    assert.equal(challenge.resource?.mimeType, "application/json");
    assert.equal(challenge.resource?.description.includes("machine-readable risk context"), true);
    assert.deepEqual(
      Object.keys(challenge.resource?.extensions?.bazaar ?? {}).sort(),
      ["info", "schema"]
    );
    assert.deepEqual(
      challenge.resource?.extensions?.bazaar?.info?.input,
      {
        type: "http",
        method: "POST",
        bodyType: "json",
        body: {
          subject_id: "agent_public_paid_proof",
          context: {
            action: "execute_task",
            domain: "agentic_market",
            capital_at_risk_usd: 1000
          }
        }
      }
    );
    assert.deepEqual(
      challenge.resource?.extensions?.bazaar?.schema?.required,
      ["input"]
    );

    const unpaidEmptyJson = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(unpaidEmptyJson.status, 402);

    const paymentPayload = {
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:8453",
        amount: "10000",
        asset: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
        payTo: "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3",
        maxTimeoutSeconds: 300
      },
      payload: {
        authorization: {
          from: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
          to: "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3",
          value: "10000",
          validAfter: "1777403986",
          validBefore: "1777404286",
          nonce: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        signature: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    };
    const paymentSignature = Buffer.from(JSON.stringify(paymentPayload), "utf8").toString("base64");
    const response = await fetch(`http://127.0.0.1:${port}/v1/resolve-trust`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": paymentSignature
      },
      body: JSON.stringify({
        subject_id: "agent_paid_signature",
        context: { task_type: "marketplace_routing", domain: "general", risk_level: "medium" }
      })
    });
    assert.equal(response.status, 200);
    assert.equal(capturedPayment?.paymentPayload?.x402Version, 2);
    assert.equal(capturedPayment?.paymentRequirements?.network, "eip155:8453");
    assert.equal(capturedPayment?.paymentRequirements?.amount, "10000");
    assert.equal(typeof capturedPayment?.paymentRequirements?.amount, "string");
    assert.equal(capturedPayment?.paymentPayload?.payload?.authorization?.from, "0x4cC773d286E5aA52591E9E6ebed062cC057C441E");
    assert.equal(capturedPayment?.paymentPayload?.payload?.authorization?.to, "0xe4E8908308a86aB43E5dEb6C0fd0F006786104c3");
    assert.equal(capturedPayment?.paymentPayload?.payload?.authorization?.value, "10000");
    assert.equal(capturedPayment?.paymentPayload?.payload?.authorization?.nonce, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  } finally {
    await transport.close();
  }
});
