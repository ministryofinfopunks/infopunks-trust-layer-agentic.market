function baseUrl(config) {
  return config.publicUrl ?? `http://${config.host}:${config.port}`;
}

export function buildAiPluginManifest(config) {
  const url = baseUrl(config);
  return {
    schema_version: "v1",
    name_for_human: "Infopunks Trust Score",
    name_for_model: "infopunks_trust_score",
    description_for_human: "Trust resolution and routing for agents with x402-paid MCP tools.",
    description_for_model:
      "Use this service to resolve trust, select validators/executors, evaluate disputes, fetch traces, and quote risk via MCP with x402 receipts.",
    auth: {
      type: "none"
    },
    api: {
      type: "mcp",
      url: `${url}/mcp`
    },
    logo_url: "https://agentic.market/assets/infopunks.png",
    contact_email: "builders@infopunks.ai",
    legal_info_url: "https://agentic.market/terms"
  };
}
