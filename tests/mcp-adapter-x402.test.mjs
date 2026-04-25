import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";

import { AdapterStateStore } from "../services/mcp-adapter/src/storage/state-store.mjs";
import { EntitlementService } from "../services/mcp-adapter/src/payments/entitlements.mjs";
import { X402Verifier } from "../services/mcp-adapter/src/payments/x402-verifier.mjs";
import { EntitlementTokenValidator } from "../services/mcp-adapter/src/security/entitlement-token.mjs";
import { ReconciliationService } from "../services/mcp-adapter/src/payments/reconciliation-service.mjs";
import { McpServer } from "../services/mcp-adapter/src/transport/mcp-server.mjs";
import { findTool } from "../services/mcp-adapter/src/config/tool-registry.mjs";

function makeStore(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "mcp-adapter-x402-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return new AdapterStateStore({ dbPath: path.join(dir, "adapter.db") });
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signHs256Token({ payload, secret }) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

test("anti-replay store rejects duplicate nonce", (t) => {
  const store = makeStore(t);
  const first = store.assertNotReplay({
    nonce: "nonce-1",
    proofId: "proof-1",
    sessionId: "sess-1",
    payer: "payer-1",
    toolName: "resolve_trust",
    replayWindowSeconds: 300,
    verifierReference: "ref-1"
  });
  assert.equal(first.ok, true);

  const second = store.assertNotReplay({
    nonce: "nonce-1",
    proofId: "proof-1",
    sessionId: "sess-1",
    payer: "payer-1",
    toolName: "resolve_trust",
    replayWindowSeconds: 300,
    verifierReference: "ref-1"
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "PAYMENT_REPLAY_DETECTED");
});

test("anti-replay store rejects duplicate proof_id even with different nonce", (t) => {
  const store = makeStore(t);
  const first = store.assertNotReplay({
    nonce: "nonce-11",
    proofId: "proof-same",
    sessionId: "sess-1",
    payer: "payer-1",
    toolName: "resolve_trust",
    replayWindowSeconds: 300,
    verifierReference: "ref-11"
  });
  assert.equal(first.ok, true);

  const second = store.assertNotReplay({
    nonce: "nonce-12",
    proofId: "proof-same",
    sessionId: "sess-2",
    payer: "payer-1",
    toolName: "select_validators",
    replayWindowSeconds: 300,
    verifierReference: "ref-12"
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "PAYMENT_REPLAY_DETECTED");
});

test("strict verifier rejects invalid proof", async (t) => {
  const verifier = new X402Verifier({
    mode: "strict",
    sharedSecret: "secret",
    timeoutMs: 2000,
    verifierUrl: null,
    verifierApiKey: null,
    logger: null
  });

  const result = await verifier.verify({
    payment: {
      rail: "x402",
      payer: "payer-1",
      units_authorized: 2,
      nonce: "n1",
      proof: "bad"
    },
    requiredUnits: 1,
    operation: "resolve_trust",
    fallbackPayer: "payer-1",
    adapterTraceId: "mcp_trc_test",
    entitlement: null
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "PAYMENT_VERIFICATION_FAILED");
});

test("facilitator verifier rejects ok response without replay identity", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, payer: "payer-1", units_authorized: 3 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const verifier = new X402Verifier({
    mode: "facilitator",
    verifierUrl: "http://facilitator.test",
    timeoutMs: 2000,
    logger: null
  });
  const result = await verifier.verify({
    payment: { rail: "x402", payer: "payer-1", units_authorized: 3 },
    requiredUnits: 1,
    operation: "resolve_trust",
    fallbackPayer: "payer-1",
    adapterTraceId: "mcp_trc_facilitator",
    entitlement: null
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "PAYMENT_VERIFICATION_FAILED");
});

test("facilitator verifier accepts x402-native payment payload/requirements shape", async (t) => {
  const originalFetch = globalThis.fetch;
  let postedBody = null;
  globalThis.fetch = async (_url, init) => {
    postedBody = JSON.parse(init?.body ?? "{}");
    return new Response(
      JSON.stringify({
        isValid: true,
        verifier_reference: "rcpt_123",
        settlement_status: "settled"
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const verifier = new X402Verifier({
    mode: "facilitator",
    verifierUrl: "http://facilitator.test",
    timeoutMs: 2000,
    logger: null
  });

  const paymentPayload = {
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
        nonce: "0xabc"
      }
    }
  };

  const result = await verifier.verify({
    payment: {
      rail: "x402",
      paymentPayload,
      paymentRequirements: paymentPayload.accepted
    },
    requiredUnits: 1,
    operation: "resolve_trust",
    fallbackPayer: "payer-1",
    adapterTraceId: "mcp_trc_native",
    entitlement: null
  });

  assert.equal(postedBody.paymentPayload.x402Version, 2);
  assert.equal(postedBody.paymentRequirements.network, "eip155:84532");
  assert.equal(result.ok, true);
  assert.equal(result.nonce, "0xabc");
});

test("entitlement service creates provisional receipt and spend state", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  const result = await entitlementService.authorizeAndBill({
    operation: "resolve_trust",
    payment: { rail: "x402", payer: "payer-1", units_authorized: 10, nonce: "n2" },
    fallbackPayer: "payer-1",
    spendLimitUnits: 100,
    adapterTraceId: "mcp_trc_bill",
    entitlement: null
  });

  assert.equal(result.billed_units, 1);
  assert.ok(result.payment_receipt_id);
  assert.equal(result.spend_controls.units_spent_today, 1);
});

test("entitlement service accepts Base Sepolia USDC contract address when config uses symbol", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"]
    },
    logger: null
  });

  const result = await entitlementService.authorizeAndBill({
    operation: "resolve_trust",
    payment: {
      rail: "x402",
      payer: "payer-asset-address",
      units_authorized: 5,
      nonce: "n-asset-address",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    },
    fallbackPayer: "payer-asset-address",
    spendLimitUnits: 100,
    adapterTraceId: "mcp_trc_asset_addr",
    entitlement: null
  });

  assert.equal(result.billed_units, 1);
});

test("entitlement service accepts Base Sepolia USDC contract address with 0X prefix", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"]
    },
    logger: null
  });

  const result = await entitlementService.authorizeAndBill({
    operation: "resolve_trust",
    payment: {
      rail: "x402",
      payer: "payer-asset-address-uppercase",
      units_authorized: 5,
      nonce: "n-asset-address-uppercase",
      network: "eip155:84532",
      asset: "0X036CBD53842C5426634E7929541EC2318F3DCF7E"
    },
    fallbackPayer: "payer-asset-address-uppercase",
    spendLimitUnits: 100,
    adapterTraceId: "mcp_trc_asset_addr_upper",
    entitlement: null
  });

  assert.equal(result.billed_units, 1);
});

test("entitlement service rejects unsupported asset address", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100,
      x402AcceptedAssets: ["USDC"],
      x402SupportedNetworks: ["eip155:84532"]
    },
    logger: null
  });

  await assert.rejects(
    entitlementService.authorizeAndBill({
      operation: "resolve_trust",
      payment: {
        rail: "x402",
        payer: "payer-bad-asset",
        units_authorized: 5,
        nonce: "n-bad-asset",
        network: "eip155:84532",
        asset: "0x0000000000000000000000000000000000000001"
      },
      fallbackPayer: "payer-bad-asset",
      spendLimitUnits: 100,
      adapterTraceId: "mcp_trc_bad_asset",
      entitlement: null
    }),
    (error) => error?.code === "PAYMENT_VERIFICATION_FAILED" && /Unsupported payment asset/i.test(error?.message ?? "")
  );
});

test("reservePaidOperation enforces spend limit atomically", (t) => {
  const store = makeStore(t);
  const first = store.reservePaidOperation({
    nonce: "nonce-a",
    proofId: "proof-a",
    sessionId: "sess-a",
    payer: "payer-atomic",
    toolName: "resolve_trust",
    replayWindowSeconds: 300,
    verifierReference: "ref-a",
    billedUnits: 1,
    adapterTraceId: "mcp_trc_a",
    metadata: {},
    spendLimitUnits: 1
  });
  assert.equal(first.ok, true);

  const second = store.reservePaidOperation({
    nonce: "nonce-b",
    proofId: "proof-b",
    sessionId: "sess-b",
    payer: "payer-atomic",
    toolName: "resolve_trust",
    replayWindowSeconds: 300,
    verifierReference: "ref-b",
    billedUnits: 1,
    adapterTraceId: "mcp_trc_b",
    metadata: {},
    spendLimitUnits: 1
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "ENTITLEMENT_REQUIRED");
});

test("entitlement token validator validates HS256 token and scope", async (t) => {
  const store = makeStore(t);
  const secret = "super-secret";
  const token = signHs256Token({
    payload: {
      iss: "agentic.market",
      aud: "infopunks-mcp",
      sub: "agent_1",
      payer: "payer-1",
      sid: "session-1",
      jti: "jti-1",
      scope: "resolve_trust select_validators",
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600
    },
    secret
  });

  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: false,
      entitlementIssuer: "agentic.market",
      entitlementAudience: "infopunks-mcp",
      entitlementHmacSecret: secret,
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });

  const validated = await validator.validate({
    token,
    toolName: "resolve_trust",
    adapterTraceId: "mcp_trc_token"
  });

  assert.equal(validated.session_id, "session-1");
  assert.equal(validated.token_jti, "jti-1");
});

test("entitlement token validator rejects missing token when required", async (t) => {
  const store = makeStore(t);
  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: true,
      entitlementIssuer: null,
      entitlementAudience: null,
      entitlementHmacSecret: "secret",
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });

  await assert.rejects(
    () =>
      validator.validate({
        token: null,
        toolName: "resolve_trust",
        adapterTraceId: "mcp_trc_missing",
        required: true
      }),
    (error) => error?.code === "ENTITLEMENT_REQUIRED"
  );
});

test("entitlement token validator rejects wrong tool scope", async (t) => {
  const store = makeStore(t);
  const secret = "scope-secret";
  const token = signHs256Token({
    payload: {
      iss: "agentic.market",
      aud: "infopunks-mcp",
      sub: "agent_1",
      payer: "payer-1",
      sid: "session-scope-1",
      jti: "jti-scope-1",
      scope: "select_validators",
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600
    },
    secret
  });

  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: false,
      entitlementIssuer: "agentic.market",
      entitlementAudience: "infopunks-mcp",
      entitlementHmacSecret: secret,
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });

  await assert.rejects(
    () =>
      validator.validate({
        token,
        toolName: "resolve_trust",
        adapterTraceId: "mcp_trc_scope"
      }),
    (error) => error?.code === "ENTITLEMENT_REQUIRED"
  );
});

test("entitlement token validator rejects caller mismatch", async (t) => {
  const store = makeStore(t);
  const secret = "caller-secret";
  const token = signHs256Token({
    payload: {
      iss: "agentic.market",
      aud: "infopunks-mcp",
      sub: "agent_rightful",
      payer: "payer-1",
      sid: "session-caller-1",
      jti: "jti-caller-1",
      scope: "resolve_trust",
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 600
    },
    secret
  });

  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: false,
      entitlementIssuer: "agentic.market",
      entitlementAudience: "infopunks-mcp",
      entitlementHmacSecret: secret,
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });

  await assert.rejects(
    () =>
      validator.validate({
        token,
        toolName: "resolve_trust",
        adapterTraceId: "mcp_trc_caller",
        callerContext: { external_agent_id: "agent_attacker" }
      }),
    (error) => error?.code === "PAYMENT_VERIFICATION_FAILED"
  );
});

test("entitlement token validator rejects payer mismatch and accepts audience array", async (t) => {
  const store = makeStore(t);
  const secret = "payer-secret";
  const payload = {
    iss: "agentic.market",
    aud: ["bazaar", "infopunks-mcp"],
    sub: "agent_1",
    payer: "payer-1",
    sid: "session-payer-1",
    jti: "jti-payer-1",
    scope: "resolve_trust",
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600
  };
  const token = signHs256Token({ payload, secret });

  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: false,
      entitlementIssuer: "agentic.market",
      entitlementAudience: "infopunks-mcp",
      entitlementHmacSecret: secret,
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });

  const valid = await validator.validate({
    token,
    toolName: "resolve_trust",
    adapterTraceId: "mcp_trc_payer_ok",
    paymentContext: { payer: "payer-1" }
  });
  assert.equal(valid.session_id, "session-payer-1");

  await assert.rejects(
    () =>
      validator.validate({
        token,
        toolName: "resolve_trust",
        adapterTraceId: "mcp_trc_payer_bad",
        paymentContext: { payer: "payer-other" }
      }),
    (error) => error?.code === "PAYMENT_VERIFICATION_FAILED"
  );
});

test("entitlement token validator rejects expired token", async (t) => {
  const store = makeStore(t);
  const secret = "exp-secret";
  const token = signHs256Token({
    payload: {
      iss: "agentic.market",
      aud: "infopunks-mcp",
      sub: "agent_1",
      payer: "payer-1",
      sid: "session-exp-1",
      jti: "jti-exp-1",
      scope: "resolve_trust",
      iat: Math.floor(Date.now() / 1000) - 100,
      exp: Math.floor(Date.now() / 1000) - 40
    },
    secret
  });
  const validator = new EntitlementTokenValidator({
    config: {
      entitlementTokenRequired: true,
      entitlementRequireForPaidTools: true,
      entitlementFallbackAllow: false,
      entitlementIssuer: "agentic.market",
      entitlementAudience: "infopunks-mcp",
      entitlementHmacSecret: secret,
      entitlementPublicKeyPem: null,
      entitlementAllowedAlgorithms: ["HS256"],
      entitlementClockSkewSeconds: 30,
      entitlementMaxTtlSeconds: 3600
    },
    store,
    logger: null
  });
  await assert.rejects(
    () =>
      validator.validate({
        token,
        toolName: "resolve_trust",
        adapterTraceId: "mcp_trc_exp"
      }),
    (error) => error?.code === "PAYMENT_SESSION_EXPIRED"
  );
});

test("reconciliation service applies settled webhook state", async (t) => {
  const store = makeStore(t);
  const receipt = await store.createProvisionalReceipt({
    verifierReference: "ref-100",
    proofId: "proof-100",
    sessionId: "sess-100",
    payer: "payer-1",
    toolName: "resolve_trust",
    billedUnits: 1,
    adapterTraceId: "mcp_trc_100",
    metadata: {}
  });

  const reconciliationService = new ReconciliationService({
    store,
    verifier: { getReceiptStatus: async () => null },
    logger: null
  });

  const result = await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "settled"
  });

  assert.equal(result.ok, true);
  const unsettled = await store.listUnsettledReceipts(10);
  assert.equal(unsettled.length, 0);
});

test("reconciliation ignores settlement downgrades and stays idempotent", async (t) => {
  const store = makeStore(t);
  const receipt = await store.createProvisionalReceipt({
    verifierReference: "ref-200",
    proofId: "proof-200",
    sessionId: "sess-200",
    payer: "payer-1",
    toolName: "resolve_trust",
    billedUnits: 1,
    adapterTraceId: "mcp_trc_200",
    metadata: {}
  });

  const reconciliationService = new ReconciliationService({
    store,
    verifier: { getReceiptStatus: async () => null },
    logger: null
  });

  const first = await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "settled"
  });
  assert.equal(first.ok, true);

  const second = await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "pending"
  });
  assert.equal(second.ok, true);
  assert.equal(second.ignored, true);
  assert.equal(second.reason, "terminal_state_preserved");

  const third = await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "settled"
  });
  assert.equal(third.ok, false);
  assert.equal(third.update_reason, "NOOP");
});

test("entitlement service rejects duplicate proof even when replay strict is disabled", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: false,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  await entitlementService.authorizeAndBill({
    operation: "resolve_trust",
    payment: { rail: "x402", payer: "payer-1", units_authorized: 10, nonce: "nonce-A", proof_id: "proof-DUP" },
    fallbackPayer: "payer-1",
    spendLimitUnits: 100,
    adapterTraceId: "mcp_trc_dup_1",
    entitlement: null
  });

  await assert.rejects(
    () =>
      entitlementService.authorizeAndBill({
        operation: "resolve_trust",
        payment: { rail: "x402", payer: "payer-1", units_authorized: 10, nonce: "nonce-B", proof_id: "proof-DUP" },
        fallbackPayer: "payer-1",
        spendLimitUnits: 100,
        adapterTraceId: "mcp_trc_dup_2",
        entitlement: null
      }),
    (error) => error?.code === "REPLAY_DETECTED"
  );
});

test("entitlement service rejects reused nonce with REPLAY_DETECTED", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  await entitlementService.authorizeAndBill({
    operation: "resolve_trust",
    payment: { rail: "x402", payer: "payer-replay", units_authorized: 4, nonce: "nonce-replay-1" },
    fallbackPayer: "payer-replay",
    spendLimitUnits: 100,
    adapterTraceId: "mcp_trc_replay_1",
    entitlement: null
  });

  await assert.rejects(
    () =>
      entitlementService.authorizeAndBill({
        operation: "resolve_trust",
        payment: { rail: "x402", payer: "payer-replay", units_authorized: 4, nonce: "nonce-replay-1" },
        fallbackPayer: "payer-replay",
        spendLimitUnits: 100,
        adapterTraceId: "mcp_trc_replay_2",
        entitlement: null
      }),
    (error) => error?.code === "REPLAY_DETECTED"
  );
});

test("idempotency returns cached response for same key and payload", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  let handlerCalls = 0;
  const server = new McpServer({
    config: {
      adapterName: "test-adapter",
      adapterVersion: "test",
      callerResolutionPolicy: "lookup-only",
      x402RequiredDefault: true,
      paidRequestTimestampWindowSeconds: 120,
      x402VerifierMode: "stub"
    },
    logger: { info() {}, warn() {}, error() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller-1" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: async () => {
        handlerCalls += 1;
        return {
          subject_id: "agent_1",
          score: 55,
          band: "watch",
          confidence: 0.7,
          decision: "allow_with_validation",
          reason_codes: ["idempotency_test"]
        };
      }
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });

  const tool = findTool("resolve_trust");
  const args = {
    subject_id: "agent_1",
    context: { task_type: "market_analysis" },
    payment: {
      rail: "x402",
      payer: "payer-idem",
      units_authorized: 5,
      nonce: "nonce-idem-1",
      idempotency_key: "idem-key-1",
      request_timestamp: Date.now()
    }
  };

  const first = await server.executeTool(tool, args, "mcp_trc_idem_1");
  const second = await server.executeTool(tool, args, "mcp_trc_idem_2");

  assert.equal(first.result.score, 55);
  assert.equal(second.result.score, 55);
  assert.equal(handlerCalls, 1);
});

test("idempotency rejects same key with different payload", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  const server = new McpServer({
    config: {
      adapterName: "test-adapter",
      adapterVersion: "test",
      callerResolutionPolicy: "lookup-only",
      x402RequiredDefault: true,
      paidRequestTimestampWindowSeconds: 120,
      x402VerifierMode: "stub"
    },
    logger: { info() {}, warn() {}, error() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller-1" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: async ({ args: currentArgs }) => ({
        subject_id: currentArgs.subject_id,
        score: currentArgs.context?.risk_level === "high" ? 30 : 65,
        band: "watch",
        confidence: 0.6,
        decision: "allow_with_validation",
        reason_codes: ["idempotency_conflict_test"]
      })
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });

  const tool = findTool("resolve_trust");
  await server.executeTool(tool, {
    subject_id: "agent_1",
    context: { task_type: "market_analysis", risk_level: "low" },
    payment: {
      rail: "x402",
      payer: "payer-idem-conflict",
      units_authorized: 5,
      nonce: "nonce-idem-2",
      idempotency_key: "idem-key-2",
      request_timestamp: Date.now()
    }
  }, "mcp_trc_idem_conflict_1");

  await assert.rejects(
    () => server.executeTool(tool, {
      subject_id: "agent_1",
      context: { task_type: "market_analysis", risk_level: "high" },
      payment: {
        rail: "x402",
        payer: "payer-idem-conflict",
        units_authorized: 5,
        nonce: "nonce-idem-3",
        idempotency_key: "idem-key-2",
        request_timestamp: Date.now()
      }
    }, "mcp_trc_idem_conflict_2"),
    (error) => error?.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("stale request timestamp is rejected", async (t) => {
  const store = makeStore(t);
  const entitlementService = new EntitlementService({
    verifier: new X402Verifier({ mode: "stub", logger: null }),
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  const server = new McpServer({
    config: {
      adapterName: "test-adapter",
      adapterVersion: "test",
      callerResolutionPolicy: "lookup-only",
      x402RequiredDefault: true,
      paidRequestTimestampWindowSeconds: 120,
      x402VerifierMode: "stub"
    },
    logger: { info() {}, warn() {}, error() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller-1" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: async () => ({
        subject_id: "agent_1",
        score: 40,
        band: "watch",
        confidence: 0.5,
        decision: "allow_with_validation",
        reason_codes: []
      })
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });

  const staleTimestamp = Date.now() - 10 * 60 * 1000;
  await assert.rejects(
    () => server.executeTool(findTool("resolve_trust"), {
      subject_id: "agent_1",
      context: { task_type: "market_analysis" },
      payment: {
        rail: "x402",
        payer: "payer-stale",
        units_authorized: 5,
        nonce: "nonce-stale",
        idempotency_key: "idem-stale",
        request_timestamp: staleTimestamp
      }
    }, "mcp_trc_stale"),
    (error) => error?.code === "REQUEST_TIMESTAMP_INVALID"
  );
});

test("failed paid tool call marks receipt and usage as failed without spend inflation", async (t) => {
  const store = makeStore(t);
  const verifier = new X402Verifier({ mode: "stub", logger: null });
  const entitlementService = new EntitlementService({
    verifier,
    store,
    config: {
      x402RequiredDefault: true,
      x402ReplayStrict: true,
      x402ReplayWindowSeconds: 600,
      x402DailySpendLimitUnits: 100
    },
    logger: null
  });

  const server = new McpServer({
    config: {
      adapterName: "test-adapter",
      adapterVersion: "test",
      callerResolutionPolicy: "lookup-only"
    },
    logger: { info() {}, error() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService,
    subjectResolution: { resolveCaller: async () => ({ subject_id: "caller-1" }) },
    apiClient: { health: async () => true },
    toolHandlers: {
      resolve_trust: async () => {
        const err = new Error("upstream outage");
        err.code = "UPSTREAM_UNAVAILABLE";
        err.status = 503;
        throw err;
      }
    },
    tokenValidator: null,
    store,
    reconciliationService: { reconcileOnce: async () => ({ ok: true }) }
  });

  const tool = findTool("resolve_trust");
  await assert.rejects(
    () =>
      server.executeTool(tool, {
        subject_id: "agent_1",
        context: { task_type: "market_analysis" },
        payment: { rail: "x402", payer: "payer-1", units_authorized: 5, nonce: "nonce-fail" }
      }, "mcp_trc_fail"),
    (error) => error?.code === "UPSTREAM_UNAVAILABLE"
  );

  const receipt = await store.getReceiptByVerifierReference("stub_ref_mcp_trc_fail");
  assert.ok(receipt);
  assert.equal(receipt.receipt_status, "failed");
  assert.equal(receipt.settlement_status, "failed");

  const usage = store.db.prepare("SELECT usage_status, billed_units, receipt_id FROM tool_usage_ledger WHERE adapter_trace_id = ?").get("mcp_trc_fail");
  assert.equal(usage.usage_status, "failed");
  assert.equal(usage.billed_units, 1);
  assert.ok(usage.receipt_id);

  const spend = await store.spendState("payer-1");
  assert.equal(spend.units_spent_today, 0);
});

test("reconciliation service ignores settlement downgrade events", async (t) => {
  const store = makeStore(t);
  const receipt = await store.createProvisionalReceipt({
    verifierReference: "ref-200",
    proofId: "proof-200",
    sessionId: "sess-200",
    payer: "payer-1",
    toolName: "resolve_trust",
    billedUnits: 1,
    adapterTraceId: "mcp_trc_200",
    metadata: {}
  });

  const reconciliationService = new ReconciliationService({
    store,
    verifier: { getReceiptStatus: async () => null },
    logger: null
  });

  await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "settled"
  });
  const downgrade = await reconciliationService.applySettlementEvent({
    receipt_id: receipt.receipt_id,
    verifier_reference: receipt.verifier_reference,
    status: "pending"
  });

  assert.equal(downgrade.ok, true);
  assert.equal(downgrade.ignored, true);
  const stored = await store.getReceiptById(receipt.receipt_id);
  assert.equal(stored.settlement_status, "settled");
});

test("distributed lock renewal fails after lease expiry", async (t) => {
  const store = makeStore(t);
  const owner = "worker-a";
  const acquired = await store.acquireLock("reconcile", owner, 1);
  assert.equal(acquired, true);

  const renewedImmediately = await store.renewLock("reconcile", owner, 1);
  assert.equal(renewedImmediately, true);

  const expiredAt = new Date(Date.now() - 1000).toISOString();
  store.db
    .prepare("UPDATE distributed_locks SET expires_at = ? WHERE lock_name = ?")
    .run(expiredAt, "reconcile");

  const renewedAfterExpiry = await store.renewLock("reconcile", owner, 1);
  assert.equal(renewedAfterExpiry, false);
});
