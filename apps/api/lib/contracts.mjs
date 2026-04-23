export function shapePromptPack(prompt) {
  return prompt;
}

export function shapeTraceReplayBundle(bundle) {
  return {
    resource_type: "trace_replay_bundle",
    trace_id: bundle.trace?.trace_id ?? null,
    ...bundle
  };
}

export function shapeTrustExplanation({ subjectId, resolution, snapshot, recentEvents }) {
  return {
    resource_type: "trust_explanation",
    subject_id: subjectId,
    context_hash: resolution.context_hash,
    resolution: {
      resolution_id: resolution.resolution_id,
      score: resolution.score,
      band: resolution.band,
      confidence: resolution.confidence,
      decision: resolution.decision,
      reason_codes: resolution.reason_codes,
      policy_actions: resolution.policy_actions,
      recommended_validators: resolution.recommended_validators,
      score_breakdown: resolution.score_breakdown,
      trace_id: resolution.trace_id,
      expires_at: resolution.expires_at,
      created_at: resolution.created_at
    },
    snapshot,
    recent_event_lineage: recentEvents,
    explanation: {
      summary: `${subjectId} is ${resolution.band} for the scoped context.`,
      reason_codes: resolution.reason_codes,
      policy_actions: resolution.policy_actions
    }
  };
}

export function shapeWarRoomState(state) {
  return {
    resource_type: "war_room_state",
    ...state
  };
}
