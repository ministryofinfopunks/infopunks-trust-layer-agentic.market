import { TOOL_PRICING } from "./pricing.mjs";

function tool(name, title, description, inputSchema, operation, handler) {
  return {
    name,
    title,
    description,
    inputSchema,
    outputSchema: TOOL_OUTPUT_SCHEMAS[operation] ?? { type: "object", additionalProperties: true },
    operation,
    handler,
    pricing: TOOL_PRICING[operation]
  };
}

export const TOOL_OUTPUT_SCHEMAS = {
  resolve_trust: {
    type: "object",
    properties: {
      resolution_id: { type: "string" },
      subject_id: { type: "string" },
      score: { type: "integer" },
      band: { type: "string" },
      confidence: { type: "number" },
      decision: { type: "string" },
      trust_state: { type: "string" },
      trust_vector: { type: "object", additionalProperties: true },
      trust_policy: { type: "object", additionalProperties: true },
      trust_evidence: { type: "object", additionalProperties: true },
      agentic_market: { type: "object", additionalProperties: true },
      reason_codes: { type: "array", items: { type: "string" } },
      recommended_validators: { type: "array", items: { type: "object", additionalProperties: true } },
      policy_actions: { type: "array", items: { type: "string" } },
      trace_id: { type: "string" },
      mode: { type: "string" },
      trust_score: { type: "number" },
      trust_tier: { type: "string" },
      reason: { type: "string" }
    },
    required: ["subject_id", "score", "decision", "confidence"],
    additionalProperties: true
  }
};

export const TOOL_REGISTRY = [
  tool("resolve_trust", "Resolve Trust", "Resolve trust for an agentic subject.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      context: { type: "object", additionalProperties: true },
      policy_id: { type: "string" },
      policy_version: { type: "string" },
      include: { type: "array", items: { type: "string" } },
      candidate_validators: { type: "array", items: { type: "string" } },
      response_mode: { type: "string", enum: ["minimal", "standard", "explain", "audit"] },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["subject_id", "context"],
    additionalProperties: false
  }, "resolve_trust", "resolve_trust")
];

export function findTool(name) {
  return TOOL_REGISTRY.find((entry) => entry.name === name || entry.operation === name);
}
