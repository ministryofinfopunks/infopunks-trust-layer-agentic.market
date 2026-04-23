export async function selectValidatorsTool({ args, subjectResolution, apiClient, config, adapterTraceId }) {
  const targetSubjectId = args.subject_id;
  await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);

  return apiClient.selectValidators({
    task_id: args.task_id,
    subject_id: targetSubjectId,
    candidates: args.candidates,
    context: args.context ?? {
      task_type: "agentic.market.validation",
      domain: config.defaultDomain,
      risk_level: config.defaultRiskLevel
    },
    minimum_count: args.minimum_count,
    quorum_policy: args.quorum_policy
  }, adapterTraceId);
}
