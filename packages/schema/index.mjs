export const SUBJECT_TYPES = [
  "agent",
  "validator",
  "operator_service",
  "tool_adapter"
];

export const PASSPORT_STATUSES = [
  "active",
  "suspended",
  "revoked"
];

export const EVIDENCE_EVENT_TYPES = [
  "task.completed",
  "task.failed",
  "task.timeout",
  "validation.passed",
  "validation.failed",
  "validation.reversed",
  "dispute.opened",
  "dispute.resolved",
  "route.selected",
  "route.blocked",
  "collusion.suspected",
  "passport.revoked",
  "CLEAN_EXECUTION",
  "PAYMENT_VERIFIED",
  "PAYMENT_FAILED",
  "REPLAY_ATTEMPT",
  "DUPLICATE_PAYMENT_SIGNATURE",
  "MALFORMED_PAYLOAD",
  "PAYLOAD_MISMATCH",
  "VERIFIER_DELAY",
  "RATE_SPIKE",
  "OUTPUT_INCONSISTENCY",
  "DEPENDENCY_FAILURE",
  "MANUAL_OVERRIDE",
  "QUARANTINE"
];

export const TRUST_BANDS = [
  "privileged",
  "preferred",
  "allowed",
  "watch",
  "restricted",
  "quarantined"
];

export const TRUST_DECISIONS = [
  "allow",
  "allow_with_validation",
  "restrict",
  "deny"
];

export const DEFAULT_POLICY = {
  policy_id: "policy_default",
  version: "1.0.0",
  trust_bands: {
    privileged: { min: 90, max: 100 },
    preferred: { min: 75, max: 89 },
    allowed: { min: 60, max: 74 },
    watch: { min: 40, max: 59 },
    restricted: { min: 20, max: 39 },
    quarantined: { min: 0, max: 19 }
  },
  risk_rules: {
    low: {
      minimum_band_for_execution: "watch",
      minimum_band_for_validation: "allowed",
      watch_action: "allow_with_validation"
    },
    medium: {
      minimum_band_for_execution: "allowed",
      minimum_band_for_validation: "preferred",
      watch_action: "allow_with_validation"
    },
    high: {
      minimum_band_for_execution: "allowed",
      minimum_band_for_validation: "preferred",
      watch_action: "restrict"
    }
  },
  thresholds: {
    minimum_confidence_high_risk: 0.7,
    mutual_validation_ratio_penalty: 0.6,
    closed_cluster_density_penalty: 0.8,
    minimum_validator_diversity: 3,
    default_quorum_consensus_threshold: 0.67,
    maximum_executor_collusion_risk: 0.55,
    trust_spike_delta: 10,
    trust_collapse_delta: -15
  },
  actions: {
    watch: ["require_dual_validation", "limit_capital_exposure"],
    restricted: ["require_manual_escalation"],
    quarantined: ["block_execution", "block_validation"],
    quorum_unsatisfied: ["add_independent_validators", "reroute_execution"]
  }
};

export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "PAYLOAD_TOO_LARGE",
  "UNKNOWN_SUBJECT",
  "PASSPORT_REVOKED",
  "PASSPORT_SUSPENDED",
  "INSUFFICIENT_EVIDENCE",
  "LOW_CONFIDENCE",
  "POLICY_BLOCKED",
  "RATE_LIMITED",
  "TRACE_UNAVAILABLE",
  "CONFLICTING_EVIDENCE",
  "TEMPORARY_UNAVAILABLE",
  "IDEMPOTENCY_CONFLICT"
];
