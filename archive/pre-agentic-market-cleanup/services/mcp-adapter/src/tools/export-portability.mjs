export async function exportPortabilityTool({ args, subjectResolution, apiClient, adapterTraceId }) {
  const caller = await subjectResolution.resolveCaller(args.agent ?? {}, undefined, adapterTraceId);
  const targetSubjectId = args.subject_id ?? caller.subject_id;
  if (targetSubjectId !== caller.subject_id) {
    await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);
  }

  return apiClient.exportPortability({
    subject_id: targetSubjectId,
    include_evidence: args.include_evidence,
    evidence_limit: args.evidence_limit,
    include_trace_ids: args.include_trace_ids,
    target_network: args.target_network
  }, adapterTraceId);
}
