export async function evaluateDisputeTool({ args, subjectResolution, apiClient, adapterTraceId }) {
  const targetSubjectId = args.subject_id;
  await subjectResolution.resolveTarget(targetSubjectId, { createIfMissing: false }, adapterTraceId);

  return apiClient.evaluateDispute({
    subject_id: targetSubjectId,
    task_id: args.task_id,
    evidence_ids: args.evidence_ids,
    context: args.context,
    reason_code: args.reason_code,
    severity: args.severity,
    preferred_resolution: args.preferred_resolution,
    disputed_by: args.disputed_by,
    notes: args.notes
  }, adapterTraceId);
}
