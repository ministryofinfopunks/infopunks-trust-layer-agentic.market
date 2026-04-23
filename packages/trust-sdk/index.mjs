function buildHeaders(client, extra = {}, hasBody = false) {
  return {
    accept: "application/json",
    ...(hasBody ? { "content-type": "application/json" } : {}),
    authorization: `Bearer ${client.apiKey}`,
    ...extra
  };
}

function resolveBaseUrl(environment, explicitBaseUrl) {
  if (explicitBaseUrl) {
    return explicitBaseUrl.trim().replace(/\/$/, "");
  }
  const env = environment ?? "local";
  if (env === "prod") {
    return "https://api.infopunks.ai";
  }
  if (env === "staging") {
    return "https://staging.api.infopunks.ai";
  }
  if (env === "dev") {
    return "https://dev.api.infopunks.ai";
  }
  return "http://127.0.0.1:4010";
}

function normalizeCapability(entry) {
  if (typeof entry === "string") {
    return {
      name: entry,
      version: "1.0",
      verified: false
    };
  }
  return {
    name: entry.name,
    version: entry.version ?? "1.0",
    verified: entry.verified ?? false
  };
}

function normalizePublicKey(entry, index = 0) {
  if (typeof entry === "string") {
    return {
      kid: `key_${index + 1}`,
      alg: "EdDSA",
      public_key: entry
    };
  }
  return {
    kid: entry.kid ?? `key_${index + 1}`,
    alg: entry.alg ?? "EdDSA",
    public_key: entry.public_key ?? entry.publicKey
  };
}

function normalizeMetadata(metadata = {}) {
  return {
    framework: metadata.framework,
    owner_org: metadata.owner_org ?? metadata.ownerOrg,
    model_class: metadata.model_class ?? metadata.modelClass,
    runtime_version: metadata.runtime_version ?? metadata.runtimeVersion,
    ...Object.fromEntries(
      Object.entries(metadata).filter(
        ([key]) =>
          !["framework", "ownerOrg", "owner_org", "modelClass", "model_class", "runtimeVersion", "runtime_version"].includes(key)
      )
    )
  };
}

function normalizePassportInput(input) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    subject_type: input.subject_type ?? input.subjectType,
    did:
      input.did ??
      (Array.isArray(input.publicKeys) && typeof input.publicKeys[0] === "string" ? input.publicKeys[0] : undefined),
    issuer: input.issuer,
    public_keys: (input.public_keys ?? input.publicKeys ?? []).map(normalizePublicKey),
    capabilities: (input.capabilities ?? []).map(normalizeCapability),
    reputation_scope_defaults: input.reputation_scope_defaults ?? input.reputationScopeDefaults,
    metadata: normalizeMetadata(input.metadata ?? {})
  };
}

function normalizePassportKeyRotationInput(input) {
  return {
    key: normalizePublicKey(input.key ?? input.publicKey ?? input.public_key, 0),
    reason: input.reason
  };
}

function normalizeContext(context = {}) {
  return {
    task_type: context.task_type ?? context.taskType,
    domain: context.domain,
    risk_level: context.risk_level ?? context.riskLevel,
    requires_validation: context.requires_validation ?? context.requiresValidation,
    ...Object.fromEntries(
      Object.entries(context).filter(
        ([key]) => !["task_type", "taskType", "domain", "risk_level", "riskLevel", "requires_validation", "requiresValidation"].includes(key)
      )
    )
  };
}

function normalizeTrustResolveInput(input) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    context: normalizeContext(input.context),
    policy_id: input.policy_id ?? input.policyId,
    policy_version: input.policy_version ?? input.policyVersion,
    include: input.include,
    response_mode: input.response_mode ?? input.responseMode,
    candidate_validators: input.candidate_validators ?? input.candidateValidators
  };
}

function normalizeRoutingInput(input) {
  const quorumPolicy = input.quorum_policy ?? input.quorumPolicy;
  return {
    task_id: input.task_id ?? input.taskId,
    subject_id: input.subject_id ?? input.subjectId,
    candidates: input.candidates,
    context: normalizeContext(input.context),
    minimum_count: input.minimum_count ?? input.minimumCount,
    quorum_policy: quorumPolicy
      ? {
          mode: quorumPolicy.mode,
          required_count: quorumPolicy.required_count ?? quorumPolicy.requiredCount,
          consensus_threshold: quorumPolicy.consensus_threshold ?? quorumPolicy.consensusThreshold,
          escalation_action: quorumPolicy.escalation_action ?? quorumPolicy.escalationAction
        }
      : undefined
  };
}

function normalizeExecutorRoutingInput(input) {
  return {
    task_id: input.task_id ?? input.taskId,
    subject_id: input.subject_id ?? input.subjectId,
    candidates: input.candidates,
    context: normalizeContext(input.context),
    minimum_count: input.minimum_count ?? input.minimumCount,
    maximum_cost_usd: input.maximum_cost_usd ?? input.maximumCostUsd,
    allow_autonomy_downgrade: input.allow_autonomy_downgrade ?? input.allowAutonomyDowngrade
  };
}

function normalizeOutcome(outcome = {}) {
  return {
    status: outcome.status,
    latency_ms: outcome.latency_ms ?? outcome.latencyMs,
    cost_usd: outcome.cost_usd ?? outcome.costUsd,
    quality_score: outcome.quality_score ?? outcome.qualityScore,
    confidence_score: outcome.confidence_score ?? outcome.confidenceScore
  };
}

function normalizeProvenance(provenance = {}) {
  return {
    source_system: provenance.source_system ?? provenance.sourceSystem,
    trace_id: provenance.trace_id ?? provenance.traceId,
    span_id: provenance.span_id ?? provenance.spanId
  };
}

function normalizeDispute(dispute = {}) {
  return {
    dispute_id: dispute.dispute_id ?? dispute.disputeId,
    status: dispute.status,
    reason_code: dispute.reason_code ?? dispute.reasonCode,
    opened_at: dispute.opened_at ?? dispute.openedAt,
    resolved_at: dispute.resolved_at ?? dispute.resolvedAt
  };
}

function normalizeEvidenceInput(input) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    event_type: input.event_type ?? input.eventType,
    task_id: input.task_id ?? input.taskId,
    context: normalizeContext(input.context),
    outcome: normalizeOutcome(input.outcome),
    validators: (input.validators ?? []).map((validator) => ({
      validator_id: validator.validator_id ?? validator.validatorId,
      verdict: validator.verdict,
      weight: validator.weight,
      reason_codes: validator.reason_codes ?? validator.reasonCodes ?? []
    })),
    disputes: (input.disputes ?? []).map(normalizeDispute),
    provenance: normalizeProvenance(input.provenance)
  };
}

function normalizeDisputeInput(input) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    task_id: input.task_id ?? input.taskId,
    evidence_ids: input.evidence_ids ?? input.evidenceIds,
    context: normalizeContext(input.context),
    reason_code: input.reason_code ?? input.reasonCode,
    severity: input.severity,
    preferred_resolution: input.preferred_resolution ?? input.preferredResolution,
    disputed_by: input.disputed_by ?? input.disputedBy,
    notes: input.notes
  };
}

function normalizeSimInput(input = {}) {
  return {
    ...input,
    number_of_agents: input.number_of_agents ?? input.numberOfAgents,
    number_of_validators: input.number_of_validators ?? input.numberOfValidators,
    domain_mix: input.domain_mix ?? input.domainMix,
    failure_rate: input.failure_rate ?? input.failureRate,
    collusion_probability: input.collusion_probability ?? input.collusionProbability,
    reversal_probability: input.reversal_probability ?? input.reversalProbability
  };
}

function normalizeWebhookInput(input) {
  return {
    url: input.url,
    secret: input.secret,
    event_types: input.event_types ?? input.eventTypes,
    subjects: input.subjects,
    max_attempts: input.max_attempts ?? input.maxAttempts
  };
}

function normalizeBudgetQuoteInput(input = {}) {
  return {
    operation: input.operation,
    subject_id: input.subject_id ?? input.subjectId,
    context: normalizeContext(input.context),
    response_mode: input.response_mode ?? input.responseMode,
    evidence_window: input.evidence_window ?? input.evidenceWindow,
    budget_cap_units: input.budget_cap_units ?? input.budgetCapUnits
  };
}

function normalizePortabilityExportInput(input = {}) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    include_evidence: input.include_evidence ?? input.includeEvidence,
    evidence_limit: input.evidence_limit ?? input.evidenceLimit,
    include_trace_ids: input.include_trace_ids ?? input.includeTraceIds,
    target_network: input.target_network ?? input.targetNetwork
  };
}

function normalizePortabilityImportInput(input = {}) {
  return {
    bundle: input.bundle,
    import_mode: input.import_mode ?? input.importMode
  };
}

function normalizeEconomicInput(input = {}) {
  return {
    subject_id: input.subject_id ?? input.subjectId,
    task_id: input.task_id ?? input.taskId,
    context: normalizeContext(input.context),
    notional_usd: input.notional_usd ?? input.notionalUsd,
    duration_hours: input.duration_hours ?? input.durationHours,
    include_recent_evidence: input.include_recent_evidence ?? input.includeRecentEvidence,
    evidence_limit: input.evidence_limit ?? input.evidenceLimit
  };
}

function normalizeQueryValue(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    const joined = value.filter((entry) => entry !== undefined && entry !== null && entry !== "").join(",");
    return joined || null;
  }
  const normalized = String(value);
  return normalized === "" ? null : normalized;
}

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const normalized = normalizeQueryValue(value);
    if (normalized !== null) {
      searchParams.set(key, normalized);
    }
  }
  return searchParams.toString();
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class InfopunksApiError extends Error {
  constructor(message, { status, body, requestPath }) {
    super(message);
    this.name = "InfopunksApiError";
    this.status = status;
    this.body = body;
    this.requestPath = requestPath;
    this.code = body?.error?.code ?? "UNKNOWN_ERROR";
  }
}

async function request(client, path, options = {}) {
  const hasBody = options.body !== undefined;
  const response = await fetch(`${client.baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: buildHeaders(client, options.headers, hasBody),
    body: hasBody ? JSON.stringify(options.body) : undefined,
    signal: options.signal ?? AbortSignal.timeout(client.timeoutMs)
  });

  const parsedBody = await parseResponseBody(response);
  if (!response.ok) {
    throw new InfopunksApiError(parsedBody?.error?.message ?? `Request failed with ${response.status}`, {
      status: response.status,
      body: parsedBody,
      requestPath: path
    });
  }

  return parsedBody;
}

function linkAbortSignals(parentSignal, childController) {
  if (!parentSignal) {
    return () => {};
  }
  if (parentSignal.aborted) {
    childController.abort(parentSignal.reason);
    return () => {};
  }
  const forward = () => childController.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", forward, { once: true });
  return () => parentSignal.removeEventListener("abort", forward);
}

export class Infopunks {
  constructor({ apiKey, baseUrl, environment = "local", timeoutMs = 5000 }) {
    if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new TypeError("Infopunks requires a non-empty apiKey.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("Infopunks requires a positive timeoutMs.");
    }

    this.apiKey = apiKey.trim();
    this.environment = environment;
    this.baseUrl = resolveBaseUrl(environment, baseUrl);
    this.timeoutMs = timeoutMs;
    this.passports = {
      register: (input, opts = {}) =>
        request(this, "/v1/passports", {
          method: "POST",
          body: normalizePassportInput(input),
          headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {},
          signal: opts.signal
        }),
      get: (subjectId, opts = {}) =>
        request(this, `/v1/passports/${encodeURIComponent(subjectId)}`, { signal: opts.signal }),
      rotateKey: (subjectId, input, opts = {}) =>
        request(this, `/v1/passports/${encodeURIComponent(subjectId)}/rotate-key`, {
          method: "POST",
          body: normalizePassportKeyRotationInput(input),
          signal: opts.signal
        })
    };
    this.evidence = {
      record: (input, opts = {}) =>
        request(this, "/v1/evidence", {
          method: "POST",
          body: normalizeEvidenceInput(input),
          headers: opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {},
          signal: opts.signal
        })
    };
    this.budget = {
      quote: (input, opts = {}) =>
        request(this, "/v1/budget/quote", {
          method: "POST",
          body: normalizeBudgetQuoteInput(input),
          signal: opts.signal
        })
    };
    this.webhooks = {
      create: (input, opts = {}) =>
        request(this, "/v1/webhooks", {
          method: "POST",
          body: normalizeWebhookInput(input),
          signal: opts.signal
        })
    };
    this.portability = {
      export: (input, opts = {}) =>
        request(this, "/v1/portability/export", {
          method: "POST",
          body: normalizePortabilityExportInput(input),
          signal: opts.signal
        }),
      import: (input, opts = {}) =>
        request(this, "/v1/portability/import", {
          method: "POST",
          body: normalizePortabilityImportInput(input),
          signal: opts.signal
        })
    };
    this.disputes = {
      evaluate: (input, opts = {}) =>
        request(this, "/v1/disputes/evaluate", {
          method: "POST",
          body: normalizeDisputeInput(input),
          signal: opts.signal
        })
    };
    this.trust = {
      resolve: (input, opts = {}) =>
        request(this, "/v1/trust/resolve", {
          method: "POST",
          body: normalizeTrustResolveInput(input),
          signal: opts.signal
        }),
      explain: (subjectId, params = {}, opts = {}) => {
        const query = buildQueryString(params);
        return request(this, `/v1/trust/${encodeURIComponent(subjectId)}/explain${query ? `?${query}` : ""}`, {
          signal: opts.signal
        });
      }
    };
    this.routing = {
      selectValidator: (input, opts = {}) =>
        request(this, "/v1/routing/select-validator", {
          method: "POST",
          body: normalizeRoutingInput(input),
          signal: opts.signal
        }),
      selectExecutor: (input, opts = {}) =>
        request(this, "/v1/routing/select-executor", {
          method: "POST",
          body: normalizeExecutorRoutingInput(input),
          signal: opts.signal
        })
    };
    this.economic = {
      escrowQuote: (input, opts = {}) =>
        request(this, "/v1/economic/escrow-quote", {
          method: "POST",
          body: normalizeEconomicInput(input),
          signal: opts.signal
        }),
      riskPrice: (input, opts = {}) =>
        request(this, "/v1/economic/risk-price", {
          method: "POST",
          body: normalizeEconomicInput(input),
          signal: opts.signal
        }),
      attestationBundle: (input, opts = {}) =>
        request(this, "/v1/economic/attestation-bundle", {
          method: "POST",
          body: normalizeEconomicInput(input),
          signal: opts.signal
        })
    };
    this.traces = {
      get: (traceId, opts = {}) =>
        request(this, `/v1/traces/${encodeURIComponent(traceId)}`, { signal: opts.signal })
    };
    this.prompts = {
      get: (name, opts = {}) =>
        request(this, `/v1/prompts/${encodeURIComponent(name)}`, { signal: opts.signal })
    };
    this.sim = {
      runScenario: (input = {}, opts = {}) =>
        request(this, "/v1/sim/run", {
          method: "POST",
          body: normalizeSimInput(input),
          signal: opts.signal
        })
    };
    this.events = {
      subscribe: (filtersOrType = {}, maybeHandler, options = {}) => {
        const filters = typeof filtersOrType === "string" ? { types: filtersOrType } : filtersOrType;
        const handler = typeof filtersOrType === "string" ? maybeHandler : maybeHandler ?? (() => {});
        const query = buildQueryString(filters);
        const controller = new AbortController();
        const unlink = linkAbortSignals(options.signal, controller);
        const done = (async () => {
          try {
            const response = await fetch(`${this.baseUrl}/v1/events/stream${query ? `?${query}` : ""}`, {
              headers: {
                accept: "text/event-stream",
                authorization: `Bearer ${this.apiKey}`
              },
              signal: controller.signal
            });
            if (!response.ok) {
              const body = await parseResponseBody(response);
              throw new InfopunksApiError(body?.error?.message ?? "Unable to subscribe to event stream.", {
                status: response.status,
                body,
                requestPath: "/v1/events/stream"
              });
            }
            if (!response.body) {
              throw new Error("Event stream body unavailable.");
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            while (true) {
              const { done: readerDone, value } = await reader.read();
              if (readerDone) {
                break;
              }
              buffer += decoder.decode(value, { stream: true });
              const frames = buffer.split("\n\n");
              buffer = frames.pop() ?? "";
              for (const frame of frames) {
                const dataLine = frame
                  .split("\n")
                  .find((entry) => entry.startsWith("data: "));
                if (!dataLine) {
                  continue;
                }
                try {
                  const payload = JSON.parse(dataLine.slice(6));
                  if (!(payload?.type || payload?.event_type)) {
                    continue;
                  }
                  handler(payload);
                } catch (error) {
                  if (options.onError) {
                    options.onError(error);
                  }
                }
              }
            }
          } finally {
            unlink();
          }
        })();

        return {
          abort() {
            controller.abort();
          },
          done
        };
      }
    };
  }
}
