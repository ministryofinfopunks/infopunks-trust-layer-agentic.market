import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { ensureTraceId } from "../services/mcp-adapter/src/middleware/request-id.mjs";
import { mapUpstreamError } from "../services/mcp-adapter/src/schemas/error-schema.mjs";
import { ReconciliationService } from "../services/mcp-adapter/src/payments/reconciliation-service.mjs";
import { __testOnly as httpTestOnly } from "../services/mcp-adapter/src/transport/http-server.mjs";

test("ensureTraceId rejects caller-supplied poisoned trace ids", () => {
  const poisoned = ensureTraceId({
    params: {
      adapter_trace_id: "mcp_trc_bad\n{\"log\":\"poison\"}"
    }
  });
  assert.match(poisoned, /^mcp_trc_[a-z0-9]+$/i);
  assert.equal(poisoned.includes("\n"), false);
});

test("mapUpstreamError redacts upstream internals from tool error details", () => {
  const mapped = mapUpstreamError(
    {
      code: "INTERNAL_ERROR",
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "database exploded",
          details: {
            sql: "select * from secrets",
            token: "super-sensitive"
          }
        }
      }
    },
    "mcp_trc_test",
    "resolve_trust"
  );

  assert.equal(mapped.error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(mapped.error.details.upstream_status, 500);
  assert.equal("upstream_details" in mapped.error.details, false);
});

test("reconciliation settlement event requires receipt reference", async () => {
  const service = new ReconciliationService({
    store: {
      getReceiptById: () => null,
      getReceiptByVerifierReference: () => null,
      updateReceiptSettlement: () => ({ updated: false, reason: "RECEIPT_NOT_FOUND" })
    },
    verifier: { getReceiptStatus: async () => null },
    logger: null
  });

  const result = await service.applySettlementEvent({ status: "settled" });
  assert.equal(result.ok, false);
  assert.equal(result.update_reason, "missing_receipt_reference");
});

test("admin token helper rejects unauthorized reconcile callers", () => {
  const config = { adminToken: "admin-secret", adminEndpointsRequireToken: true };
  const unauthorized = httpTestOnly.requireAdminToken({ headers: {} }, config);
  const authorized = httpTestOnly.requireAdminToken(
    { headers: { authorization: "Bearer admin-secret" } },
    config
  );
  assert.equal(unauthorized, false);
  assert.equal(authorized, true);
});

test("webhook hmac helper validates signature and timestamp skew", () => {
  const rawBody = JSON.stringify({ receipt_id: "xrc_1", status: "settled" });
  const ts = Math.floor(Date.now() / 1000).toString();
  const secret = "webhook-secret";
  const signature = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");

  const config = {
    settlementWebhookHmacSecret: secret,
    settlementWebhookMaxSkewSeconds: 300
  };

  const valid = httpTestOnly.verifyWebhookHmac({
    req: { headers: { "x-webhook-timestamp": ts, "x-webhook-signature": signature } },
    rawBody,
    config
  });
  const invalid = httpTestOnly.verifyWebhookHmac({
    req: { headers: { "x-webhook-timestamp": ts, "x-webhook-signature": "bad" } },
    rawBody,
    config
  });

  assert.equal(valid, true);
  assert.equal(invalid, false);
});
