import { TOOL_PRICING } from "./pricing.mjs";

function baseUrl(config) {
  return config.publicUrl ?? `http://${config.host}:${config.port}`;
}

export function buildMarketplaceManifest(config) {
  const url = baseUrl(config);
  return {
    service: {
      name: "Infopunks Trust Score",
      slug: "infopunks-trust-score",
      version: config.adapterVersion,
      category: "trust-routing",
      categories: ["trust-routing", "agent-security", "risk-infrastructure"],
      keywords: [
        "agent trust",
        "trust-aware routing",
        "validator selection",
        "executor selection",
        "dispute resolution",
        "trace replay",
        "risk pricing",
        "x402",
        "mcp"
      ],
      summary: "Trust resolution, validator/executor routing, disputes, and trace replay for agents via x402-paid MCP tools.",
      one_liner: "Call Infopunks between discovery and execution to avoid low-trust routes.",
      install_time_minutes: 5
    },
    discovery: {
      protocol: "mcp",
      transport: "http",
      url: `${url}/mcp`,
      bazaar_metadata_url: `${url}/.well-known/x402-bazaar.json`,
      readiness_url: `${url}/marketplace/readiness`,
      openapi_url: `${url}/openapi.json`,
      trust_layer_metadata_url: `${url}/.well-known/infopunks-trust-layer.json`
    },
    authentication: {
      external_api_keys: false,
      payment_rail: "x402",
      internal_auth_model: "bearer_service_token"
    },
    payment: {
      rail: "x402",
      accepted_assets: config.x402AcceptedAssets ?? ["USDC"],
      supported_networks: config.x402SupportedNetworks ?? ["eip155:84532"],
      model: "per_call_units",
      pricing_units: Object.fromEntries(Object.entries(TOOL_PRICING).map(([tool, entry]) => [tool, entry?.units ?? 0]))
    },
    http_api: {
      endpoints: [
        {
          path: "/v1/resolve-trust",
          method: "POST",
          paid: true,
          price_units: TOOL_PRICING.resolve_trust?.units ?? 1
        },
        {
          path: "/trust-score",
          method: "POST",
          paid: true,
          legacy_alias: true,
          price_units: TOOL_PRICING.resolve_trust?.units ?? 1
        },
        {
          path: "/agent-reputation/{id}",
          method: "GET",
          paid: false
        },
        {
          path: "/verify-evidence",
          method: "POST",
          paid: false
        }
      ]
    }
  };
}
