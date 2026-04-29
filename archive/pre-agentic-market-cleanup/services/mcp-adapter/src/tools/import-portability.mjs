export async function importPortabilityTool({ args, apiClient, adapterTraceId }) {
  return apiClient.importPortability({
    bundle: args.bundle,
    import_mode: args.import_mode
  }, adapterTraceId);
}
