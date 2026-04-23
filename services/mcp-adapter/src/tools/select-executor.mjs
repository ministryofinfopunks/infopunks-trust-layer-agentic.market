export async function selectExecutorTool({ args, subjectResolution, apiClient, config, adapterTraceId }) {
  const targetSubjectId = args.subject_id;
  await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);

  return apiClient.selectExecutor({
    task_id: args.task_id,
    subject_id: targetSubjectId,
    candidates: args.candidates,
    context: args.context ?? {
      task_type: "agentic.market.execution",
      domain: config.defaultDomain,
      risk_level: config.defaultRiskLevel
    },
    minimum_count: args.minimum_count,
    maximum_cost_usd: args.maximum_cost_usd,
    allow_autonomy_downgrade: args.allow_autonomy_downgrade
  }, adapterTraceId);
}
