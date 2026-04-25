function isoFromOffset(offsetSeconds) {
  return new Date(Date.now() - offsetSeconds * 1000).toISOString();
}

const eventTemplates = [
  {
    event_type: "trust.collapse",
    subject_id: "agent_221",
    trace_id: "trc_221",
    data: { severity: "critical", delta: -35, reason: "validator_reversal" }
  },
  {
    event_type: "route.changed",
    subject_id: "agent_044",
    trace_id: "trc_044",
    data: { severity: "notice", rerouted: true, selected: "agent_553" }
  },
  {
    event_type: "quarantine.enforced",
    subject_id: "agent_221",
    trace_id: "trc_221",
    data: { severity: "critical", tasks_rerouted: 3 }
  },
  {
    event_type: "trust.spike",
    subject_id: "agent_318",
    trace_id: "trc_318",
    data: { severity: "notice", delta: 9, reason: "replay_confirmed" }
  },
  {
    event_type: "validator.reject",
    subject_id: "agent_082",
    trace_id: "trc_082",
    data: { severity: "watch", reason: "replay_mismatch" }
  },
  {
    event_type: "warroom.alert.raised",
    subject_id: "agent_119",
    trace_id: "trc_119",
    data: { severity: "watch", reason: "latency_breach" }
  }
];

function shapeEvent(template, tick, offset = 0) {
  const createdAt = isoFromOffset(offset);

  return {
    event_id: `evt_${tick}_${template.subject_id}`,
    event_type: template.event_type,
    subject_id: template.subject_id,
    trace_id: template.trace_id,
    created_at: createdAt,
    specversion: "1.0",
    type: template.event_type,
    source: "infopunks.mock",
    subject: template.subject_id,
    id: `evt_${tick}_${template.subject_id}`,
    time: createdAt,
    datacontenttype: "application/json",
    data: template.data
  };
}

function baseMovers() {
  return [
    { subject_id: "agent_221", current_score: 57, delta: -35, band: "quarantined" },
    { subject_id: "agent_044", current_score: 93, delta: 14, band: "preferred" },
    { subject_id: "agent_082", current_score: 61, delta: -21, band: "restricted" },
    { subject_id: "agent_318", current_score: 89, delta: 9, band: "preferred" },
    { subject_id: "agent_119", current_score: 73, delta: -11, band: "watch" }
  ];
}

function baseQuarantines() {
  return [
    {
      resolution_id: "res_221",
      subject_id: "agent_221",
      context_hash: "ctx_221",
      score: 57,
      band: "quarantined",
      confidence: 0.91,
      decision: "deny",
      reason_codes: ["validator_reversal"],
      recommended_validators: [{ subject_id: "agent_553", score: 0.97, fit_score: 0.94 }],
      policy_actions: ["reroute_pending_work", "require_human_review"],
      score_breakdown: { validator_reversal: -35 },
      trace_id: "trc_221",
      engine_version: "trust-engine@1.0.0",
      policy_version: "policy_default@1.0.0",
      expires_at: isoFromOffset(-3600),
      created_at: isoFromOffset(72)
    }
  ];
}

function baseRouting() {
  return [
    {
      routing_id: "route_001",
      task_id: "settlement_review",
      route_type: "validator",
      subject_id: "agent_221",
      selected: [{ subject_id: "agent_553", selection_score: 0.97, why: ["high trust", "sector match"] }],
      rejected: [{ subject_id: "agent_221", why: ["quarantined"] }],
      policy_actions: ["reroute"],
      rerouted: true,
      reroute_reason: "quarantine",
      quorum: { mode: "majority", required_count: 2, selected_count: 2, consensus_threshold: 0.75, satisfied: true, escalation_action: null },
      trace_id: "trc_221",
      created_at: isoFromOffset(68)
    },
    {
      routing_id: "route_002",
      task_id: "claims_triage",
      route_type: "validator",
      subject_id: "agent_119",
      selected: [{ subject_id: "agent_318", selection_score: 0.91, why: ["latency headroom"] }],
      rejected: [],
      policy_actions: ["secondary_validation"],
      rerouted: false,
      reroute_reason: null,
      quorum: { mode: "threshold", required_count: 1, selected_count: 1, consensus_threshold: 0.7, satisfied: true, escalation_action: null },
      trace_id: "trc_119",
      created_at: isoFromOffset(124)
    }
  ];
}

function baseClusters() {
  return [
    { subject_id: "agent_221", collusion_risk: 0.84, closed_cluster_density: 0.72, validator_diversity_score: 0.24 },
    { subject_id: "agent_044", collusion_risk: 0.21, closed_cluster_density: 0.31, validator_diversity_score: 0.88 },
    { subject_id: "agent_082", collusion_risk: 0.64, closed_cluster_density: 0.58, validator_diversity_score: 0.32 },
    { subject_id: "agent_318", collusion_risk: 0.18, closed_cluster_density: 0.27, validator_diversity_score: 0.91 },
    { subject_id: "agent_119", collusion_risk: 0.44, closed_cluster_density: 0.48, validator_diversity_score: 0.54 }
  ];
}

export function createMockWarRoomState() {
  const events = eventTemplates.map((template, index) => shapeEvent(template, index + 1, 180 - index * 18));

  return {
    resource_type: "war_room_state",
    generated_at: new Date().toISOString(),
    live_trust_event_feed: events,
    top_score_movers: baseMovers(),
    current_quarantines: baseQuarantines(),
    validator_routing_stream: baseRouting(),
    trust_graph_cluster_map: baseClusters(),
    recent_alerts: events.filter((event) => String(event.event_type).includes("alert") || event.data.severity === "critical").slice(0, 4),
    recent_trace_replays: [
      shapeEvent(
        {
          event_type: "task.replayed",
          subject_id: "agent_553",
          trace_id: "trc_replay",
          data: { severity: "notice", deterministic: true }
        },
        99,
        96
      )
    ],
    observability: {
      average_event_lag_ms: 142,
      last_trace_replay_at: isoFromOffset(96),
      active_alerts: 2
    }
  };
}

export function advanceMockWarRoomState(state, tick) {
  const template = eventTemplates[tick % eventTemplates.length];
  const event = shapeEvent(template, tick + 100, 0);

  const movers = state.top_score_movers.map((entry) => {
    if (entry.subject_id !== template.subject_id) {
      return entry;
    }

    const delta = Number(template.data.delta ?? (template.event_type === "trust.collapse" ? -28 : 8));
    const nextScore = Math.max(12, Math.min(99, entry.current_score + delta));
    const nextBand =
      nextScore < 60 ? "quarantined" : nextScore < 70 ? "restricted" : nextScore >= 88 ? "preferred" : entry.band;

    return {
      ...entry,
      current_score: nextScore,
      delta,
      band: nextBand
    };
  });

  const routingEntry = {
    routing_id: `route_${tick + 100}`,
    task_id: template.event_type === "route.changed" ? "risk_route" : "validation_lane",
    route_type: "validator",
    subject_id: template.subject_id,
    selected: [
      {
        subject_id: template.event_type === "trust.collapse" ? "agent_553" : "agent_318",
        selection_score: template.event_type === "trust.collapse" ? 0.97 : 0.92,
        why: [template.event_type === "trust.collapse" ? "quarantine fallback" : "confidence surplus"]
      }
    ],
    rejected: template.event_type === "validator.reject" ? [{ subject_id: template.subject_id, why: ["replay mismatch"] }] : [],
    policy_actions: [template.event_type === "trust.collapse" ? "reroute" : "observe"],
    rerouted: template.event_type === "route.changed" || template.event_type === "trust.collapse",
    reroute_reason: template.event_type === "trust.collapse" ? "quarantine" : template.event_type === "route.changed" ? "trust_shift" : null,
    quorum: { mode: "majority", required_count: 2, selected_count: 2, consensus_threshold: 0.75, satisfied: true, escalation_action: null },
    trace_id: template.trace_id,
    created_at: event.created_at
  };

  const quarantines =
    template.event_type === "trust.collapse" || template.event_type === "quarantine.enforced"
      ? [
          {
            ...state.current_quarantines[0],
            resolution_id: `res_${tick + 100}`,
            subject_id: template.subject_id,
            score: movers.find((entry) => entry.subject_id === template.subject_id)?.current_score ?? 57,
            trace_id: template.trace_id,
            created_at: event.created_at
          },
          ...state.current_quarantines.filter((entry) => entry.subject_id !== template.subject_id)
        ].slice(0, 4)
      : state.current_quarantines;

  const clusters = state.trust_graph_cluster_map.map((entry) => {
    if (entry.subject_id !== template.subject_id) {
      return entry;
    }

    return {
      ...entry,
      collusion_risk: Math.max(0.12, Math.min(0.92, entry.collusion_risk + (template.event_type === "trust.collapse" ? 0.06 : -0.04))),
      closed_cluster_density: Math.max(0.18, Math.min(0.84, entry.closed_cluster_density + (template.event_type === "route.changed" ? -0.03 : 0.04))),
      validator_diversity_score: Math.max(0.18, Math.min(0.94, entry.validator_diversity_score + (template.event_type === "trust.spike" ? 0.05 : -0.02)))
    };
  });

  const alerts = [event, ...state.recent_alerts].filter((entry, index) => index < 6);
  const replays =
    tick % 3 === 0
      ? [
          shapeEvent(
            {
              event_type: "task.replayed",
              subject_id: "agent_553",
              trace_id: `trc_replay_${tick}`,
              data: { severity: "notice", deterministic: true }
            },
            tick + 200,
            0
          ),
          ...state.recent_trace_replays
        ].slice(0, 5)
      : state.recent_trace_replays;

  return {
    state: {
      ...state,
      generated_at: new Date().toISOString(),
      live_trust_event_feed: [event, ...state.live_trust_event_feed].slice(0, 12),
      top_score_movers: movers,
      current_quarantines: quarantines,
      validator_routing_stream: [routingEntry, ...state.validator_routing_stream].slice(0, 6),
      trust_graph_cluster_map: clusters,
      recent_alerts: alerts,
      recent_trace_replays: replays,
      observability: {
        average_event_lag_ms: 120 + ((tick * 13) % 60),
        last_trace_replay_at: replays[0]?.created_at ?? state.observability.last_trace_replay_at,
        active_alerts: alerts.filter((entry) => entry.data?.severity === "critical").length
      }
    },
    event
  };
}

export function mockTraceReplay(traceId) {
  return {
    trace_id: traceId,
    replay_status: "deterministic",
    validator_outcome: "rerouted_after_collapse",
    quarantined_subject: "agent_221",
    recommended_validator: "agent_553"
  };
}
