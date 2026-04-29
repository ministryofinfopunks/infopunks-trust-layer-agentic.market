export async function quoteRiskTool({ args, subjectResolution, apiClient, config, adapterTraceId }) {
  const targetSubjectId = args.subject_id;
  await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);

  return apiClient.quoteRisk({
    subject_id: targetSubjectId,
    task_id: args.task_id,
    context: args.context ?? {
      task_type: "agentic.market.quote_risk",
      domain: config.defaultDomain,
      risk_level: config.defaultRiskLevel
    },
    notional_usd: args.exposure_usd
  }, adapterTraceId);
}
