export function buildCallerContext({ args, adapterTraceId }) {
  const payment = args?.payment ?? {};
  const agent = args?.agent ?? {};
  return {
    adapter_trace_id: adapterTraceId,
    external_agent_id: agent.agent_id ?? agent.agentId ?? agent.id ?? agent.did ?? agent.wallet ?? null,
    payer: payment.payer ?? null,
    payment_context: payment,
    marketplace: agent.marketplace ?? "agentic.market",
    runtime: agent.runtime ?? "mcp"
  };
}
