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
  get_passport: {
    type: "object",
    properties: {
      subject_id: { type: "string" },
      passport_id: { type: "string" },
      status: { type: "string" },
      created: { type: "boolean" }
    },
    required: ["subject_id", "created"],
    additionalProperties: false
  },
  resolve_trust: {
    type: "object",
    properties: {
      resolution_id: { type: "string" },
      subject_id: { type: "string" },
      score: { type: "integer" },
      band: { type: "string" },
      confidence: { type: "number" },
      decision: { type: "string" },
      reason_codes: { type: "array", items: { type: "string" } },
      recommended_validators: { type: "array", items: { type: "object", additionalProperties: true } },
      policy_actions: { type: "array", items: { type: "string" } },
      trace_id: { type: "string" }
    },
    required: ["subject_id", "score", "decision", "confidence"],
    additionalProperties: false
  },
  select_validators: {
    type: "object",
    properties: {
      routing_id: { type: "string" },
      task_id: { type: "string" },
      route_type: { type: "string" },
      subject_id: { type: "string" },
      selected: { type: "array", items: { type: "object", additionalProperties: true } },
      rejected: { type: "array", items: { type: "object", additionalProperties: true } },
      policy_actions: { type: "array", items: { type: "string" } },
      rerouted: { type: "boolean" },
      reroute_reason: { type: ["string", "null"] },
      trace_id: { type: "string" }
    },
    required: ["subject_id", "selected", "rejected", "rerouted"],
    additionalProperties: false
  },
  select_executor: {
    type: "object",
    properties: {
      routing_id: { type: "string" },
      task_id: { type: "string" },
      route_type: { type: "string" },
      subject_id: { type: "string" },
      selected: { type: "array", items: { type: "object", additionalProperties: true } },
      rejected: { type: "array", items: { type: "object", additionalProperties: true } },
      policy_actions: { type: "array", items: { type: "string" } },
      rerouted: { type: "boolean" },
      reroute_reason: { type: ["string", "null"] },
      trace_id: { type: "string" }
    },
    required: ["subject_id", "selected", "rejected", "rerouted"],
    additionalProperties: false
  },
  evaluate_dispute: {
    type: "object",
    properties: {
      dispute_id: { type: "string" },
      subject_id: { type: "string" },
      decision: { type: "string" },
      reason_codes: { type: "array", items: { type: "string" } },
      recommended_actions: { type: "array", items: { type: "string" } },
      trace_id: { type: "string" }
    },
    required: ["subject_id", "decision", "reason_codes", "recommended_actions"],
    additionalProperties: false
  },
  get_trace_replay: {
    type: "object",
    properties: {
      trace: { type: ["object", "null"], additionalProperties: true },
      passport: { type: ["object", "null"], additionalProperties: true },
      snapshot: { type: ["object", "null"], additionalProperties: true },
      evidence: { type: "array", items: { type: "object", additionalProperties: true } },
      resolution: { type: ["object", "null"], additionalProperties: true },
      routing: { type: ["object", "null"], additionalProperties: true },
      replay: { type: ["object", "null"], additionalProperties: true }
    },
    required: ["trace", "passport", "snapshot", "evidence", "resolution", "routing", "replay"],
    additionalProperties: false
  },
  get_prompt_pack: {
    type: "object",
    properties: {
      prompt_id: { type: ["string", "null"] },
      version: { type: ["string", "null"] },
      name: { type: ["string", "null"] },
      intended_stage: { type: ["string", "null"] },
      expected_inputs: { type: "array", items: { type: "string" } },
      recommended_api_calls: { type: "array", items: { type: "string" } },
      content: { type: ["string", "null"] }
    },
    required: ["name", "expected_inputs", "recommended_api_calls"],
    additionalProperties: false
  },
  export_portability_bundle: { type: "object", additionalProperties: true },
  import_portability_bundle: { type: "object", additionalProperties: true },
  quote_risk: {
    type: "object",
    properties: {
      quote_id: { type: "string" },
      subject_id: { type: "string" },
      exposure_usd: { type: "number" },
      risk_score: { type: "number" },
      premium_usd: { type: "number" },
      reasons: { type: "array", items: { type: "string" } },
      trace_id: { type: "string" }
    },
    required: ["subject_id", "exposure_usd", "risk_score", "premium_usd", "reasons"],
    additionalProperties: false
  }
};

export const TOOL_REGISTRY = [
  tool("get_passport", "Get Passport", "Resolve caller or target passport identity.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      create_if_missing: { type: "boolean" }
    },
    additionalProperties: false
  }, "get_passport", "get_passport"),
  tool("resolve_trust", "Resolve Trust", "Resolve trust for caller/subject.", {
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
  }, "resolve_trust", "resolve_trust"),
  tool("select_validators", "Select Validators", "Select validators via routing engine.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      task_id: { type: "string" },
      candidates: { type: "array", items: { type: "string" } },
      context: { type: "object", additionalProperties: true },
      minimum_count: { type: "integer" },
      quorum_policy: { type: "object", additionalProperties: true },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["subject_id", "candidates", "context"],
    additionalProperties: false
  }, "select_validators", "select_validators"),
  tool("select_executor", "Select Executor", "Select executor via routing engine.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      task_id: { type: "string" },
      candidates: { type: "array", items: { type: "string" } },
      context: { type: "object", additionalProperties: true },
      minimum_count: { type: "integer" },
      maximum_cost_usd: { type: "number" },
      allow_autonomy_downgrade: { type: "boolean" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["subject_id", "candidates", "context"],
    additionalProperties: false
  }, "select_executor", "select_executor"),
  tool("evaluate_dispute", "Evaluate Dispute", "Evaluate disputes with evidence IDs.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      task_id: { type: "string" },
      evidence_ids: { type: "array", items: { type: "string" } },
      context: { type: "object", additionalProperties: true },
      reason_code: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      preferred_resolution: { type: "string" },
      disputed_by: { type: "string" },
      notes: { type: "string" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["evidence_ids", "context", "reason_code", "severity"],
    additionalProperties: false
  }, "evaluate_dispute", "evaluate_dispute"),
  tool("get_trace_replay", "Get Trace Replay", "Fetch trace replay by trace ID.", {
    type: "object",
    properties: {
      trace_id: { type: "string" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["trace_id"],
    additionalProperties: false
  }, "get_trace_replay", "get_trace_replay"),
  tool("get_prompt_pack", "Get Prompt Pack", "Fetch machine-readable prompt pack.", {
    type: "object",
    properties: {
      name: { type: "string" }
    },
    required: ["name"],
    additionalProperties: false
  }, "get_prompt_pack", "get_prompt_pack"),
  tool("export_portability_bundle", "Export Portability Bundle", "Export portability bundle.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      include_evidence: { type: "boolean" },
      evidence_limit: { type: "integer" },
      include_trace_ids: { type: "boolean" },
      target_network: { type: "string" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    additionalProperties: false
  }, "export_portability_bundle", "export_portability_bundle"),
  tool("import_portability_bundle", "Import Portability Bundle", "Import portability bundle.", {
    type: "object",
    properties: {
      bundle: { type: "object", additionalProperties: true },
      import_mode: { type: "string" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["bundle"],
    additionalProperties: false
  }, "import_portability_bundle", "import_portability_bundle"),
  tool("quote_risk", "Quote Risk", "Get risk price quote.", {
    type: "object",
    properties: {
      agent: { type: "object", additionalProperties: true },
      subject_id: { type: "string" },
      context: { type: "object", additionalProperties: true },
      task_id: { type: "string" },
      exposure_usd: { type: "number" },
      payment: { type: "object", additionalProperties: true },
      spend_limit_units: { type: "number" }
    },
    required: ["subject_id", "context", "exposure_usd"],
    additionalProperties: false
  }, "quote_risk", "quote_risk")
];

export function findTool(name) {
  return TOOL_REGISTRY.find((entry) => entry.name === name) ?? null;
}
