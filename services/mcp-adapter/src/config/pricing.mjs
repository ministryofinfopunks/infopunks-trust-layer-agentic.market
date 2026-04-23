export const TOOL_PRICING = {
  get_passport: { mode: "free", units: 0 },
  resolve_trust: { mode: "metered", units: 1 },
  select_validators: { mode: "metered", units: 2 },
  select_executor: { mode: "metered", units: 2 },
  evaluate_dispute: { mode: "metered", units: 3 },
  get_trace_replay: { mode: "metered", units: 1 },
  get_prompt_pack: { mode: "free", units: 0 },
  export_portability_bundle: { mode: "metered", units: 2 },
  import_portability_bundle: { mode: "metered", units: 2 },
  quote_risk: { mode: "metered", units: 2 },
  subscribe_event_stream: { mode: "metered", units: 3 },
  pull_event_stream: { mode: "metered", units: 1 }
};
