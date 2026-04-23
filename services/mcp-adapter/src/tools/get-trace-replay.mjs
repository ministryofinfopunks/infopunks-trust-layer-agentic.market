export async function getTraceReplayTool({ args, apiClient, adapterTraceId }) {
  return apiClient.getTraceReplay(args.trace_id, adapterTraceId);
}
