function toStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeSelectionEntries(entries, includeScore = false) {
  return toArray(entries).map((entry) => ({
    subject_id: toStringOrNull(entry?.subject_id),
    ...(includeScore ? { selection_score: toNumberOrNull(entry?.selection_score) } : {}),
    why: toArray(entry?.why).filter((item) => typeof item === "string")
  }));
}

export function normalizeResult(operation, upstream, args = {}) {
  if (operation === "get_passport") {
    return {
      passport_id: toStringOrNull(upstream?.passport_id),
      subject_id: toStringOrNull(upstream?.subject_id) ?? toStringOrNull(args.subject_id),
      subject_type: toStringOrNull(upstream?.subject_type),
      did: toStringOrNull(upstream?.did),
      status: toStringOrNull(upstream?.status),
      issuer: typeof upstream?.issuer === "object" && upstream.issuer !== null ? upstream.issuer : null,
      public_keys: toArray(upstream?.public_keys),
      capabilities: toArray(upstream?.capabilities),
      reputation_scope_defaults: typeof upstream?.reputation_scope_defaults === "object" && upstream.reputation_scope_defaults !== null
        ? upstream.reputation_scope_defaults
        : null,
      lifecycle: typeof upstream?.lifecycle === "object" && upstream.lifecycle !== null ? upstream.lifecycle : null,
      portability: typeof upstream?.portability === "object" && upstream.portability !== null ? upstream.portability : null,
      metadata: typeof upstream?.metadata === "object" && upstream.metadata !== null ? upstream.metadata : null,
      created_at: toStringOrNull(upstream?.created_at),
      updated_at: toStringOrNull(upstream?.updated_at),
      created: Boolean(upstream?.created)
    };
  }
  if (operation === "resolve_trust") {
    return {
      resolution_id: toStringOrNull(upstream?.resolution_id),
      subject_id: toStringOrNull(upstream?.subject_id) ?? toStringOrNull(args.subject_id),
      score: toNumberOrNull(upstream?.score),
      band: toStringOrNull(upstream?.band),
      confidence: toNumberOrNull(upstream?.confidence),
      decision: toStringOrNull(upstream?.decision),
      reason_codes: toArray(upstream?.reason_codes).filter((item) => typeof item === "string"),
      recommended_validators: toArray(upstream?.recommended_validators),
      policy_actions: toArray(upstream?.policy_actions).filter((item) => typeof item === "string"),
      trust_state: toStringOrNull(upstream?.trust_state) ?? toStringOrNull(upstream?.trustState),
      trust_vector: (typeof upstream?.trust_vector === "object" && upstream?.trust_vector !== null)
        ? upstream.trust_vector
        : (typeof upstream?.trustVector === "object" && upstream?.trustVector !== null ? upstream.trustVector : null),
      trust_policy: (typeof upstream?.trust_policy === "object" && upstream?.trust_policy !== null)
        ? upstream.trust_policy
        : (typeof upstream?.policy === "object" && upstream?.policy !== null ? upstream.policy : null),
      trust_evidence: (typeof upstream?.trust_evidence === "object" && upstream?.trust_evidence !== null)
        ? upstream.trust_evidence
        : (typeof upstream?.evidence === "object" && upstream?.evidence !== null ? upstream.evidence : null),
      agentic_market: (typeof upstream?.agentic_market === "object" && upstream?.agentic_market !== null)
        ? upstream.agentic_market
        : (typeof upstream?.agenticMarket === "object" && upstream?.agenticMarket !== null ? upstream.agenticMarket : null),
      trace_id: toStringOrNull(upstream?.trace_id),
      expires_at: toStringOrNull(upstream?.expires_at),
      agentId: toStringOrNull(upstream?.agentId),
      trustState: toStringOrNull(upstream?.trustState),
      trustVector: (typeof upstream?.trustVector === "object" && upstream?.trustVector !== null) ? upstream.trustVector : null,
      policy: (typeof upstream?.policy === "object" && upstream?.policy !== null) ? upstream.policy : null,
      evidence: (typeof upstream?.evidence === "object" && upstream?.evidence !== null) ? upstream.evidence : null,
      agenticMarket: (typeof upstream?.agenticMarket === "object" && upstream?.agenticMarket !== null) ? upstream.agenticMarket : null,
      mode: toStringOrNull(upstream?.mode),
      trust_score: toNumberOrNull(upstream?.trust_score),
      trust_tier: toStringOrNull(upstream?.trust_tier),
      provisional: typeof upstream?.provisional === "boolean" ? upstream.provisional : null,
      reason: toStringOrNull(upstream?.reason)
    };
  }
  if (operation === "select_validators" || operation === "select_executor") {
    return {
      routing_id: toStringOrNull(upstream?.routing_id),
      task_id: toStringOrNull(upstream?.task_id) ?? toStringOrNull(args.task_id),
      route_type: toStringOrNull(upstream?.route_type),
      subject_id: toStringOrNull(upstream?.subject_id) ?? toStringOrNull(args.subject_id),
      selected: sanitizeSelectionEntries(upstream?.selected, true),
      rejected: sanitizeSelectionEntries(upstream?.rejected),
      policy_actions: toArray(upstream?.policy_actions).filter((item) => typeof item === "string"),
      rerouted: Boolean(upstream?.rerouted),
      reroute_reason: toStringOrNull(upstream?.reroute_reason),
      trace_id: toStringOrNull(upstream?.trace_id)
    };
  }
  if (operation === "evaluate_dispute") {
    return {
      dispute_id: toStringOrNull(upstream?.dispute_id),
      subject_id: toStringOrNull(upstream?.subject_id) ?? toStringOrNull(args.subject_id),
      decision: toStringOrNull(upstream?.decision) ?? toStringOrNull(upstream?.evaluation?.recommended_resolution),
      reason_codes: toArray(upstream?.reason_codes).length > 0
        ? toArray(upstream?.reason_codes).filter((item) => typeof item === "string")
        : [upstream?.reason_code].filter((item) => typeof item === "string"),
      recommended_actions: Array.isArray(upstream?.actions) ? upstream.actions : [],
      trace_id: toStringOrNull(upstream?.trace_id)
    };
  }
  if (operation === "get_trace_replay") {
    return {
      trace: typeof upstream?.trace === "object" && upstream.trace !== null ? upstream.trace : null,
      passport: typeof upstream?.passport === "object" && upstream.passport !== null ? upstream.passport : null,
      snapshot: typeof upstream?.snapshot === "object" && upstream.snapshot !== null ? upstream.snapshot : null,
      evidence: toArray(upstream?.evidence),
      resolution: typeof upstream?.resolution === "object" && upstream.resolution !== null ? upstream.resolution : null,
      routing: typeof upstream?.routing === "object" && upstream.routing !== null ? upstream.routing : null,
      replay: typeof upstream?.replay === "object" && upstream.replay !== null ? upstream.replay : null
    };
  }
  if (operation === "get_prompt_pack") {
    return {
      prompt_id: toStringOrNull(upstream?.prompt_id),
      version: toStringOrNull(upstream?.version),
      name: toStringOrNull(upstream?.name) ?? toStringOrNull(args.name),
      intended_stage: toStringOrNull(upstream?.intended_stage),
      expected_inputs: toArray(upstream?.expected_inputs).filter((item) => typeof item === "string"),
      recommended_api_calls: toArray(upstream?.recommended_api_calls).filter((item) => typeof item === "string"),
      content: toStringOrNull(upstream?.content)
    };
  }
  if (operation === "export_portability_bundle") {
    return typeof upstream === "object" && upstream !== null ? upstream : { bundle: null };
  }
  if (operation === "import_portability_bundle") {
    return typeof upstream === "object" && upstream !== null ? upstream : { import_status: null };
  }
  if (operation === "quote_risk") {
    const reasons = Array.isArray(upstream?.risk_factors?.reason_codes)
      ? upstream.risk_factors.reason_codes
      : Object.keys(upstream?.risk_factors ?? {});
    return {
      quote_id: toStringOrNull(upstream?.quote_id) ?? toStringOrNull(upstream?.policy_extensions?.quote_id),
      subject_id: toStringOrNull(upstream?.subject_id) ?? toStringOrNull(args.subject_id),
      exposure_usd: args.exposure_usd ?? null,
      risk_score: toNumberOrNull(upstream?.risk_score) ?? toNumberOrNull(upstream?.risk_factors?.risk_score) ?? toNumberOrNull(upstream?.risk_factors?.score),
      premium_usd: toNumberOrNull(upstream?.premium_usd),
      reasons,
      trace_id: toStringOrNull(upstream?.trace_id) ?? toStringOrNull(upstream?.risk_factors?.trace_id) ?? toStringOrNull(upstream?.policy_extensions?.trace_id)
    };
  }
  return upstream ?? null;
}

export function extractInternalTraceId(operation, upstream) {
  if (!upstream || typeof upstream !== "object") {
    return null;
  }
  if (typeof upstream.trace_id === "string") {
    return upstream.trace_id;
  }
  if (operation === "get_trace_replay") {
    return upstream.trace?.trace_id ?? upstream.trace_id ?? null;
  }
  return null;
}

export function mcpSuccessEnvelope({ result, meta }) {
  return {
    result,
    meta
  };
}
