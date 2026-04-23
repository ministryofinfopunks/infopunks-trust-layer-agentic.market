import { TOOL_REGISTRY } from "./tool-registry.mjs";

function baseUrl(config) {
  return config.publicUrl ?? `http://${config.host}:${config.port}`;
}

export function buildBazaarDiscoveryDocument(config) {
  const url = baseUrl(config);
  const toolTags = {
    get_passport: ["identity", "passport", "agent-profile"],
    resolve_trust: ["trust-score", "policy-decision", "routing-gate"],
    select_validators: ["validator-selection", "quorum", "anti-collusion"],
    select_executor: ["executor-selection", "risk-aware-routing", "cost-aware"],
    evaluate_dispute: ["dispute-resolution", "evidence-adjudication"],
    get_trace_replay: ["audit", "trace-replay", "forensics"],
    get_prompt_pack: ["prompt-pack", "trust-aware-orchestration"],
    export_portability_bundle: ["portability", "trust-state-export"],
    import_portability_bundle: ["portability", "trust-state-import"],
    quote_risk: ["risk-pricing", "exposure-quote"]
  };
  const tools = TOOL_REGISTRY.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    tags: toolTags[tool.name] ?? [],
    payable: (tool.pricing?.units ?? 0) > 0,
    pricing: {
      mode: tool.pricing?.mode ?? "free",
      units: tool.pricing?.units ?? 0,
      rail: "x402"
    },
    input_schema: tool.inputSchema,
    output_schema: tool.outputSchema
  }));

  return {
    service: {
      name: "Infopunks Trust Score",
      slug: "infopunks-trust-score",
      version: config.adapterVersion,
      category: "trust-routing",
      categories: ["trust-routing", "agent-security", "risk-infrastructure"],
      keywords: [
        "agent trust",
        "validator selection",
        "executor routing",
        "dispute evaluation",
        "trace replay",
        "x402",
        "mcp",
        "agentic market"
      ],
      one_liner: "Trust decisions and routing for agents via x402-paid MCP tools.",
      description:
        "Infopunks provides trust resolution, validator/executor routing, dispute evaluation, trace replay, and risk pricing for agent workflows.",
      when_to_call:
        "Call Infopunks before high-consequence execution, before validator/executor selection, and when conflicting evidence requires adjudication.",
      why_it_matters:
        "It reduces agent execution risk by enforcing trust-aware routing with auditable receipts and traces.",
      authentication: {
        external: "none",
        payment: "x402",
        internal_service_auth: "bearer_token",
        accepted_assets: config.x402AcceptedAssets ?? ["USDC"],
        supported_networks: config.x402SupportedNetworks ?? ["eip155:84532"]
      }
    },
    discovery: {
      facilitator_model: "indexed_after_successful_payment",
      mcp_endpoint: `${url}/mcp`,
      human_docs: `${url}/`,
      metadata_url: `${url}/.well-known/x402-bazaar.json`,
      marketplace_manifest_url: `${url}/.well-known/agentic-marketplace.json`,
      readiness_url: `${url}/marketplace/readiness`
    },
    endpoints: [
      {
        path: "/trust-score",
        method: "POST",
        payable: true,
        semantic_description: "REST alias for trust resolution with HTTP 402 challenge semantics.",
        protocol: "http+json",
        operation: "resolve_trust"
      },
      {
        path: "/agent-reputation/{id}",
        method: "GET",
        payable: false,
        semantic_description: "REST alias for reputation lookup via passport/trust explanation resources."
      },
      {
        path: "/verify-evidence",
        method: "POST",
        payable: false,
        semantic_description: "REST alias to submit evidence and receive acceptance metadata."
      },
      {
        path: "/mcp",
        method: "POST",
        payable: true,
        semantic_description: "MCP JSON-RPC endpoint for trust and routing tools.",
        protocol: "jsonrpc",
        operation: "tools/call"
      },
      {
        path: "/healthz",
        method: "GET",
        payable: false,
        semantic_description: "Health status of MCP adapter and core API reachability."
      },
      {
        path: "/.well-known/x402-bazaar.json",
        method: "GET",
        payable: false,
        semantic_description: "Bazaar discovery metadata including schemas and pricing."
      }
    ],
    tools
  };
}
