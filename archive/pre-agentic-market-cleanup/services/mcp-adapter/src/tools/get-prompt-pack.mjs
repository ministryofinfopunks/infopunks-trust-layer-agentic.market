export async function getPromptPackTool({ args, apiClient, adapterTraceId }) {
  return apiClient.getPromptPack(args.name, adapterTraceId);
}
