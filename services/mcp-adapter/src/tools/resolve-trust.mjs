import { resolveTrustWithResilience } from "../client/upstream-resilience.mjs";

export async function resolveTrustTool({ args, subjectResolution, apiClient, config, adapterTraceId }) {
  const targetSubjectId = args.subject_id;

  const target = await subjectResolution.resolveTarget(
    targetSubjectId,
    { createIfMissing: false, autoBootstrapIfMissing: true },
    adapterTraceId
  );
  if (target?.auto_bootstrapped && target?.bootstrap) {
    return {
      subject_id: targetSubjectId,
      score: Number(target.bootstrap.trust_score ?? 20),
      trust_score: Number(target.bootstrap.trust_score ?? 20),
      trust_tier: target.bootstrap.trust_tier ?? "unverified",
      provisional: true,
      mode: "degraded",
      confidence: 0.25,
      reason: "AUTO_BOOTSTRAPPED_SUBJECT",
      reason_codes: ["AUTO_BOOTSTRAPPED_SUBJECT"],
      band: "quarantined",
      decision: "restrict",
      recommended_validators: [],
      policy_actions: ["bootstrap_subject", "restrict_execution_until_evidence"]
    };
  }

  return resolveTrustWithResilience({
    subjectId: targetSubjectId,
    cacheStore: config.stateStore ?? null,
    logger: config.logger ?? null,
    attemptTimeoutMs: Number(config.upstreamAttemptTimeoutMs ?? 2000),
    executeUpstream: ({ timeoutMs }) => apiClient.resolveTrust({
      subject_id: targetSubjectId,
      context: args.context ?? {
        task_type: "agentic.market.request",
        domain: config.defaultDomain,
        risk_level: config.defaultRiskLevel
      },
      candidate_validators: args.candidate_validators,
      response_mode: args.response_mode ?? "minimal"
    }, adapterTraceId, { timeoutMs })
  });
}
