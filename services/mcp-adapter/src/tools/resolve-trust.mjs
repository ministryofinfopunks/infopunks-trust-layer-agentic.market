export async function resolveTrustTool({ args, subjectResolution, apiClient, config, adapterTraceId }) {
  const targetSubjectId = args.subject_id;

  await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);

  return apiClient.resolveTrust({
    subject_id: targetSubjectId,
    context: args.context ?? {
      task_type: "agentic.market.request",
      domain: config.defaultDomain,
      risk_level: config.defaultRiskLevel
    },
    candidate_validators: args.candidate_validators,
    response_mode: args.response_mode ?? "minimal"
  }, adapterTraceId);
}
