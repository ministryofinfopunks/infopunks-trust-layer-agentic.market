import test from "node:test";
import assert from "node:assert/strict";

import { validateToolInput } from "../services/mcp-adapter/src/schemas/tool-inputs.mjs";
import { normalizeResult } from "../services/mcp-adapter/src/schemas/tool-outputs.mjs";
import { McpServer } from "../services/mcp-adapter/src/transport/mcp-server.mjs";

function buildServerForList() {
  return new McpServer({
    config: { adapterName: "infopunks-mcp-adapter", adapterVersion: "test" },
    logger: { info() {}, error() {} },
    metrics: { inc() {} },
    rateLimiter: { hit() {} },
    entitlementService: {},
    subjectResolution: {},
    apiClient: { health: async () => true },
    toolHandlers: {},
    tokenValidator: null,
    store: {},
    reconciliationService: {}
  });
}

test("validateToolInput rejects unknown fields for strict contracts", () => {
  assert.throws(() => {
    validateToolInput("resolve_trust", {
      subject_id: "agent_1",
      context: { domain: "crypto" },
      injected_field: "should fail"
    });
  }, /Unexpected field "injected_field"/);
});

test("validateToolInput enforces typed candidate arrays", () => {
  assert.throws(() => {
    validateToolInput("select_executor", {
      subject_id: "agent_1",
      candidates: ["good", 42],
      context: { task_type: "execution", risk_level: "high" }
    });
  }, /candidates\[1\] must be a non-empty string/);
});

test("normalizeResult for resolve_trust drops unknown upstream fields", () => {
  const normalized = normalizeResult("resolve_trust", {
    subject_id: "agent_1",
    score: 67,
    band: "watch",
    confidence: 0.79,
    decision: "allow_with_validation",
    reason_codes: ["recent_validator_reversal"],
    trace_id: "trc_123",
    attacker_controlled: "leak"
  });

  assert.equal(normalized.subject_id, "agent_1");
  assert.equal(normalized.score, 67);
  assert.equal(normalized.decision, "allow_with_validation");
  assert.equal(Object.hasOwn(normalized, "attacker_controlled"), false);
});

test("tools/list only exposes public metadata fields", async () => {
  const server = buildServerForList();
  const response = await server.handleRequest({
    jsonrpc: "2.0",
    id: "1",
    method: "tools/list",
    params: {}
  });

  assert.equal(response.jsonrpc, "2.0");
  assert.ok(Array.isArray(response.result.tools));
  const firstTool = response.result.tools[0];
  assert.ok(firstTool.name);
  assert.ok(firstTool.inputSchema);
  assert.ok(firstTool.outputSchema);
  assert.equal(Object.hasOwn(firstTool, "handler"), false);
  assert.equal(Object.hasOwn(firstTool, "operation"), false);
});
