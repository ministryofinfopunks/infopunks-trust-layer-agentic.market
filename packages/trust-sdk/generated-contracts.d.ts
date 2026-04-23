// AUTO-GENERATED FROM openapi.yaml. DO NOT EDIT BY HAND.

export type ResponseCostMetadata = {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};

export type BudgetHints = {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};

export type BudgetQuoteRequest = {
  "operation": "trust.resolve" | "routing.select_validator" | "routing.select_executor" | "traces.get" | "trust.explain" | "disputes.evaluate";
  "subject_id"?: string;
  "context"?: {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "response_mode"?: "minimal" | "standard" | "explain" | "audit";
  "evidence_window"?: number;
  "budget_cap_units"?: number;
};

export type BudgetQuote = {
  "operation": string;
  "estimated_compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "budget_status": "healthy" | "watch" | "constrained";
  "explanation": Array<string>;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type PassportPublicKey = {
  "kid": string;
  "alg": string;
  "public_key": string;
};

export type PassportCapability = {
  "name": string;
  "version": string;
  "verified": boolean;
};

export type PassportIssuer = {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};

export type PassportLifecycle = {
  "status": "active" | "suspended" | "revoked";
  "status_reason": string | null;
  "last_status_change_at": string;
  "last_key_rotation_at": string | null;
  "key_count": number;
};

export type PassportPortability = {
  "portable_format": string;
  "exportable": boolean;
  "scope_defaults_included": boolean;
  "issuer_attested": boolean;
};

export type ReputationScopeDefaults = {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};

export type PassportCreateRequest = {
  "subject_id": string;
  "subject_type": "agent" | "validator" | "operator_service" | "tool_adapter";
  "did"?: string;
  "issuer"?: {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "public_keys": Array<{
  "kid": string;
  "alg": string;
  "public_key": string;
}>;
  "capabilities": Array<{
  "name": string;
  "version": string;
  "verified": boolean;
}>;
  "reputation_scope_defaults"?: {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};
  "metadata"?: {
  [key: string]: unknown;
};
};

export type PassportRotateKeyRequest = {
  "key": {
  "kid": string;
  "alg": string;
  "public_key": string;
};
  "reason"?: string;
};

export type PassportCreated = {
  "passport_id": string;
  "subject_id": string;
  "status": "active";
  "issuer": {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type Passport = {
  "passport_id": string;
  "subject_id": string;
  "status": "active";
  "issuer": {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
  "subject_type": "agent" | "validator" | "operator_service" | "tool_adapter";
  "did": string | null;
  "public_keys": Array<{
  "kid": string;
  "alg": string;
  "public_key": string;
}>;
  "capabilities": Array<{
  "name": string;
  "version": string;
  "verified": boolean;
}>;
  "reputation_scope_defaults": {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};
  "lifecycle": {
  "status": "active" | "suspended" | "revoked";
  "status_reason": string | null;
  "last_status_change_at": string;
  "last_key_rotation_at": string | null;
  "key_count": number;
};
  "portability": {
  "portable_format": string;
  "exportable": boolean;
  "scope_defaults_included": boolean;
  "issuer_attested": boolean;
};
  "metadata": {
  [key: string]: unknown;
};
  "updated_at": string;
};

export type EvidenceValidator = {
  "validator_id": string;
  "verdict": "pass" | "fail" | "abstain";
  "weight": number;
  "reason_codes": Array<string>;
};

export type EvidenceContext = {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};

export type EvidenceOutcome = {
  "status"?: string;
  "latency_ms"?: number;
  "cost_usd"?: number;
  "quality_score"?: number;
  "confidence_score"?: number;
  [key: string]: unknown;
};

export type EvidenceCreateRequest = {
  "subject_id": string;
  "event_type": "task.completed" | "task.failed" | "task.timeout" | "validation.passed" | "validation.failed" | "validation.reversed" | "dispute.opened" | "dispute.resolved" | "route.selected" | "route.blocked" | "collusion.suspected" | "passport.revoked";
  "task_id"?: string;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "outcome": {
  "status"?: string;
  "latency_ms"?: number;
  "cost_usd"?: number;
  "quality_score"?: number;
  "confidence_score"?: number;
  [key: string]: unknown;
};
  "validators"?: Array<{
  "validator_id": string;
  "verdict": "pass" | "fail" | "abstain";
  "weight": number;
  "reason_codes": Array<string>;
}>;
  "disputes"?: Array<{
  [key: string]: unknown;
}>;
  "provenance"?: {
  [key: string]: unknown;
};
};

export type DisputeEvaluateRequest = {
  "subject_id": string;
  "task_id"?: string;
  "evidence_ids": Array<string>;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "reason_code": string;
  "severity": "low" | "medium" | "high" | "critical";
  "preferred_resolution"?: "uphold_current_trust" | "request_additional_validation" | "reverse_validation_credit" | "quarantine_subject";
  "disputed_by"?: string;
  "notes"?: string;
};

export type DisputeEvaluation = {
  "dispute_id": string;
  "subject_id": string;
  "task_id": string | null;
  "status": "opened" | "resolved";
  "severity": "low" | "medium" | "high" | "critical";
  "reason_code": string;
  "evidence_ids": Array<string>;
  "evaluation": {
  "contradiction_score": number;
  "evidence_consistency": number;
  "validator_diversity": number;
  "collusion_risk": number;
  "economic_risk": number;
  "reversal_impact": number;
  "recommended_resolution": "uphold_current_trust" | "request_additional_validation" | "reverse_validation_credit" | "quarantine_subject";
};
  "actions": Array<string>;
  "trace_id": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type EvidenceAcceptedResponse = {
  "evidence_id": string;
  "accepted": boolean;
  "snapshot_update_status": "processed";
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type RecommendedValidator = {
  "subject_id": string;
  "score": number;
  "fit_score": number;
};

export type TrustResolution = {
  "resolution_id": string;
  "subject_id": string;
  "context_hash": string;
  "score": number;
  "band": "privileged" | "preferred" | "allowed" | "watch" | "restricted" | "quarantined";
  "confidence": number;
  "decision": "allow" | "allow_with_validation" | "restrict" | "deny";
  "reason_codes": Array<string>;
  "recommended_validators": Array<{
  "subject_id": string;
  "score": number;
  "fit_score": number;
}>;
  "policy_actions": Array<string>;
  "score_breakdown": {
  [key: string]: number;
};
  "trace_id": string;
  "engine_version": string;
  "policy_version": string;
  "expires_at": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type TrustResolveRequest = {
  "subject_id": string;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "policy_id"?: string;
  "policy_version"?: string;
  "include"?: Array<string>;
  "response_mode"?: "minimal" | "standard" | "explain" | "audit";
  "candidate_validators"?: Array<string>;
};

export type RoutingSelectValidatorRequest = {
  "task_id"?: string;
  "subject_id": string;
  "candidates": Array<string>;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "minimum_count"?: number;
  "quorum_policy"?: {
  "mode": "minimum" | "majority" | "threshold";
  "required_count"?: number;
  "consensus_threshold"?: number;
  "escalation_action"?: "additional_validators" | "reroute_execution" | "manual_review";
};
};

export type RoutingSelectExecutorRequest = {
  "task_id"?: string;
  "subject_id": string;
  "candidates": Array<string>;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "minimum_count"?: number;
  "maximum_cost_usd"?: number;
  "allow_autonomy_downgrade"?: boolean;
};

export type QuorumPolicy = {
  "mode": "minimum" | "majority" | "threshold";
  "required_count"?: number;
  "consensus_threshold"?: number;
  "escalation_action"?: "additional_validators" | "reroute_execution" | "manual_review";
};

export type RoutingDecision = {
  "routing_id": string;
  "task_id": string;
  "route_type": string;
  "subject_id": string;
  "selected": Array<{
  "subject_id": string;
  "selection_score": number;
  "why": Array<string>;
}>;
  "rejected": Array<{
  "subject_id": string;
  "why": Array<string>;
}>;
  "policy_actions": Array<string>;
  "rerouted": boolean;
  "reroute_reason": string | null;
  "quorum": {
  "mode": "minimum" | "majority" | "threshold";
  "required_count": number;
  "selected_count": number;
  "consensus_threshold": number;
  "satisfied": boolean;
  "escalation_action": string | null;
} | Record<string, unknown>;
  "trace_id": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type WebhookCreateRequest = {
  "url": string;
  "secret": string;
  "event_types": Array<string>;
  "subjects"?: Array<string>;
  "max_attempts"?: number;
};

export type WebhookSubscription = {
  "webhook_id": string;
  "url": string;
  "status": "active";
  "event_types": Array<string>;
  "subjects": Array<string>;
  "max_attempts": number;
  "signing_alg": "hmac-sha256";
  "secret_present": boolean;
  "created_at": string;
  "updated_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type PortabilityExportRequest = {
  "subject_id": string;
  "include_evidence"?: boolean;
  "evidence_limit"?: number;
  "include_trace_ids"?: boolean;
  "target_network"?: string;
};

export type TrustPortabilityBundle = {
  "resource_type": "trust_portability_bundle";
  "format_version": string;
  "source_environment": string;
  "exported_at": string;
  "subject": {
  "passport_id": string;
  "subject_id": string;
  "status": "active";
  "issuer": {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
  "subject_type": "agent" | "validator" | "operator_service" | "tool_adapter";
  "did": string | null;
  "public_keys": Array<{
  "kid": string;
  "alg": string;
  "public_key": string;
}>;
  "capabilities": Array<{
  "name": string;
  "version": string;
  "verified": boolean;
}>;
  "reputation_scope_defaults": {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};
  "lifecycle": {
  "status": "active" | "suspended" | "revoked";
  "status_reason": string | null;
  "last_status_change_at": string;
  "last_key_rotation_at": string | null;
  "key_count": number;
};
  "portability": {
  "portable_format": string;
  "exportable": boolean;
  "scope_defaults_included": boolean;
  "issuer_attested": boolean;
};
  "metadata": {
  [key: string]: unknown;
};
  "updated_at": string;
};
  "snapshot": {
  [key: string]: unknown;
};
  "evidence": Array<{
  [key: string]: unknown;
}>;
  "trace_refs": Array<string>;
  "receipt": {
  "receipt_id": string;
  "subject_id": string;
  "source_environment": string;
  "target_network": string;
  "signature": string;
  "signed_fields": Array<string>;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type PortabilityImportRequest = {
  "bundle": {
  "resource_type": "trust_portability_bundle";
  "format_version": string;
  "source_environment": string;
  "exported_at": string;
  "subject": {
  "passport_id": string;
  "subject_id": string;
  "status": "active";
  "issuer": {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
  "subject_type": "agent" | "validator" | "operator_service" | "tool_adapter";
  "did": string | null;
  "public_keys": Array<{
  "kid": string;
  "alg": string;
  "public_key": string;
}>;
  "capabilities": Array<{
  "name": string;
  "version": string;
  "verified": boolean;
}>;
  "reputation_scope_defaults": {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};
  "lifecycle": {
  "status": "active" | "suspended" | "revoked";
  "status_reason": string | null;
  "last_status_change_at": string;
  "last_key_rotation_at": string | null;
  "key_count": number;
};
  "portability": {
  "portable_format": string;
  "exportable": boolean;
  "scope_defaults_included": boolean;
  "issuer_attested": boolean;
};
  "metadata": {
  [key: string]: unknown;
};
  "updated_at": string;
};
  "snapshot": {
  [key: string]: unknown;
};
  "evidence": Array<{
  [key: string]: unknown;
}>;
  "trace_refs": Array<string>;
  "receipt": {
  "receipt_id": string;
  "subject_id": string;
  "source_environment": string;
  "target_network": string;
  "signature": string;
  "signed_fields": Array<string>;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};
  "import_mode"?: "merge" | "mirror";
};

export type PortabilityImportResult = {
  "imported": boolean;
  "subject_id": string;
  "imported_evidence_count": number;
  "imported_trace_refs": Array<string>;
  "import_mode": "merge" | "mirror";
  "receipt_verified": boolean;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type EscrowQuoteRequest = {
  "subject_id": string;
  "task_id"?: string;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "notional_usd": number;
};

export type EscrowQuote = {
  "subject_id": string;
  "trust_band": string;
  "escrow_ratio": number;
  "escrow_amount_usd": number;
  "rationale": Array<string>;
  "policy_extensions": {
  [key: string]: unknown;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type RiskPriceRequest = {
  "subject_id": string;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "notional_usd"?: number;
  "duration_hours"?: number;
};

export type RiskPriceQuote = {
  "subject_id": string;
  "premium_bps": number;
  "premium_usd": number;
  "risk_factors": {
  [key: string]: unknown;
};
  "policy_extensions": {
  [key: string]: unknown;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type AttestationBundleRequest = {
  "subject_id": string;
  "context": {
  "task_type"?: string;
  "domain"?: string;
  "risk_level"?: "low" | "medium" | "high";
  "requires_validation"?: boolean;
  [key: string]: unknown;
};
  "include_recent_evidence"?: boolean;
  "evidence_limit"?: number;
};

export type AttestationBundle = {
  "resource_type": "attestation_bundle";
  "attestation_id": string;
  "subject_id": string;
  "issued_at": string;
  "trust_summary": {
  "score": number;
  "band": string;
  "confidence": number;
  "decision": string;
};
  "evidence_refs": Array<string>;
  "attestors": Array<string>;
  "policy_extensions": {
  [key: string]: unknown;
};
  "signature": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type PromptPack = {
  "resource_type": "prompt_pack";
  "prompt_id": string;
  "name": string;
  "title": string;
  "kind": string;
  "version": string;
  "tags": Array<string>;
  "intended_stage": string;
  "expected_inputs": Array<string>;
  "recommended_api_calls": Array<string>;
  "content": string;
  "variants": {
  "minimal": string;
  "strict": string;
  "frameworks"?: {
  [key: string]: string;
};
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type TrustEvent = {
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
};

export type TraceReplayBundle = {
  "resource_type": "trace_replay_bundle";
  "trace_id": string;
  "trace": {
  [key: string]: unknown;
};
  "passport": {
  "passport_id": string;
  "subject_id": string;
  "status": "active";
  "issuer": {
  "issuer_id": string;
  "signature": string;
  "provenance": {
  "trust_anchor": string;
  "verification_method": string;
  "issued_at": string;
};
};
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
  "subject_type": "agent" | "validator" | "operator_service" | "tool_adapter";
  "did": string | null;
  "public_keys": Array<{
  "kid": string;
  "alg": string;
  "public_key": string;
}>;
  "capabilities": Array<{
  "name": string;
  "version": string;
  "verified": boolean;
}>;
  "reputation_scope_defaults": {
  "domains": Array<string>;
  "risk_tolerance": "low" | "medium" | "high";
};
  "lifecycle": {
  "status": "active" | "suspended" | "revoked";
  "status_reason": string | null;
  "last_status_change_at": string;
  "last_key_rotation_at": string | null;
  "key_count": number;
};
  "portability": {
  "portable_format": string;
  "exportable": boolean;
  "scope_defaults_included": boolean;
  "issuer_attested": boolean;
};
  "metadata": {
  [key: string]: unknown;
};
  "updated_at": string;
} | Record<string, unknown>;
  "snapshot": {
  [key: string]: unknown;
} | Record<string, unknown>;
  "evidence": Array<{
  [key: string]: unknown;
}>;
  "resolution": {
  "resolution_id": string;
  "subject_id": string;
  "context_hash": string;
  "score": number;
  "band": "privileged" | "preferred" | "allowed" | "watch" | "restricted" | "quarantined";
  "confidence": number;
  "decision": "allow" | "allow_with_validation" | "restrict" | "deny";
  "reason_codes": Array<string>;
  "recommended_validators": Array<{
  "subject_id": string;
  "score": number;
  "fit_score": number;
}>;
  "policy_actions": Array<string>;
  "score_breakdown": {
  [key: string]: number;
};
  "trace_id": string;
  "engine_version": string;
  "policy_version": string;
  "expires_at": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
} | Record<string, unknown>;
  "routing": {
  "routing_id": string;
  "task_id": string;
  "route_type": string;
  "subject_id": string;
  "selected": Array<{
  "subject_id": string;
  "selection_score": number;
  "why": Array<string>;
}>;
  "rejected": Array<{
  "subject_id": string;
  "why": Array<string>;
}>;
  "policy_actions": Array<string>;
  "rerouted": boolean;
  "reroute_reason": string | null;
  "quorum": {
  "mode": "minimum" | "majority" | "threshold";
  "required_count": number;
  "selected_count": number;
  "consensus_threshold": number;
  "satisfied": boolean;
  "escalation_action": string | null;
} | Record<string, unknown>;
  "trace_id": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
} | Record<string, unknown>;
  "replay": {
  "matches": boolean;
  "recomputed": {
  "score": number;
  "band": string;
  "decision": string;
  "confidence": number;
};
} | Record<string, unknown>;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type TrustExplainResponse = {
  "resource_type": "trust_explanation";
  "subject_id": string;
  "context_hash": string;
  "resolution": {
  [key: string]: unknown;
};
  "snapshot": {
  [key: string]: unknown;
};
  "recent_event_lineage": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "explanation": {
  "summary": string;
  "reason_codes": Array<string>;
  "policy_actions": Array<string>;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type WarRoomState = {
  "resource_type": "war_room_state";
  "generated_at": string;
  "live_trust_event_feed": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "top_score_movers": Array<{
  "subject_id": string;
  "current_score": number;
  "delta": number;
  "band": string;
}>;
  "current_quarantines": Array<{
  "resolution_id": string;
  "subject_id": string;
  "context_hash": string;
  "score": number;
  "band": "privileged" | "preferred" | "allowed" | "watch" | "restricted" | "quarantined";
  "confidence": number;
  "decision": "allow" | "allow_with_validation" | "restrict" | "deny";
  "reason_codes": Array<string>;
  "recommended_validators": Array<{
  "subject_id": string;
  "score": number;
  "fit_score": number;
}>;
  "policy_actions": Array<string>;
  "score_breakdown": {
  [key: string]: number;
};
  "trace_id": string;
  "engine_version": string;
  "policy_version": string;
  "expires_at": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
}>;
  "validator_routing_stream": Array<{
  "routing_id": string;
  "task_id": string;
  "route_type": string;
  "subject_id": string;
  "selected": Array<{
  "subject_id": string;
  "selection_score": number;
  "why": Array<string>;
}>;
  "rejected": Array<{
  "subject_id": string;
  "why": Array<string>;
}>;
  "policy_actions": Array<string>;
  "rerouted": boolean;
  "reroute_reason": string | null;
  "quorum": {
  "mode": "minimum" | "majority" | "threshold";
  "required_count": number;
  "selected_count": number;
  "consensus_threshold": number;
  "satisfied": boolean;
  "escalation_action": string | null;
} | Record<string, unknown>;
  "trace_id": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
}>;
  "trust_graph_cluster_map": Array<{
  "subject_id": string;
  "collusion_risk": number;
  "closed_cluster_density": number;
  "validator_diversity_score": number;
}>;
  "recent_alerts": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "recent_trace_replays": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "observability": {
  "average_event_lag_ms": number;
  "last_trace_replay_at": string | null;
  "active_alerts": number;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type SimRunRequest = {
  "scenario"?: string;
  "domain_mix"?: Array<string>;
  "number_of_agents"?: number;
  "number_of_validators"?: number;
  "failure_rate"?: number;
  "collusion_probability"?: number;
  "reversal_probability"?: number;
};

export type SimRunResponse = {
  "ok": boolean;
  "agents": number;
  "validators": number;
  "steps": number;
  "last_resolution": {
  "resolution_id": string;
  "subject_id": string;
  "context_hash": string;
  "score": number;
  "band": "privileged" | "preferred" | "allowed" | "watch" | "restricted" | "quarantined";
  "confidence": number;
  "decision": "allow" | "allow_with_validation" | "restrict" | "deny";
  "reason_codes": Array<string>;
  "recommended_validators": Array<{
  "subject_id": string;
  "score": number;
  "fit_score": number;
}>;
  "policy_actions": Array<string>;
  "score_breakdown": {
  [key: string]: number;
};
  "trace_id": string;
  "engine_version": string;
  "policy_version": string;
  "expires_at": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
} | Record<string, unknown>;
  "war_room_state": {
  "resource_type": "war_room_state";
  "generated_at": string;
  "live_trust_event_feed": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "top_score_movers": Array<{
  "subject_id": string;
  "current_score": number;
  "delta": number;
  "band": string;
}>;
  "current_quarantines": Array<{
  "resolution_id": string;
  "subject_id": string;
  "context_hash": string;
  "score": number;
  "band": "privileged" | "preferred" | "allowed" | "watch" | "restricted" | "quarantined";
  "confidence": number;
  "decision": "allow" | "allow_with_validation" | "restrict" | "deny";
  "reason_codes": Array<string>;
  "recommended_validators": Array<{
  "subject_id": string;
  "score": number;
  "fit_score": number;
}>;
  "policy_actions": Array<string>;
  "score_breakdown": {
  [key: string]: number;
};
  "trace_id": string;
  "engine_version": string;
  "policy_version": string;
  "expires_at": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
}>;
  "validator_routing_stream": Array<{
  "routing_id": string;
  "task_id": string;
  "route_type": string;
  "subject_id": string;
  "selected": Array<{
  "subject_id": string;
  "selection_score": number;
  "why": Array<string>;
}>;
  "rejected": Array<{
  "subject_id": string;
  "why": Array<string>;
}>;
  "policy_actions": Array<string>;
  "rerouted": boolean;
  "reroute_reason": string | null;
  "quorum": {
  "mode": "minimum" | "majority" | "threshold";
  "required_count": number;
  "selected_count": number;
  "consensus_threshold": number;
  "satisfied": boolean;
  "escalation_action": string | null;
} | Record<string, unknown>;
  "trace_id": string;
  "created_at": string;
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
}>;
  "trust_graph_cluster_map": Array<{
  "subject_id": string;
  "collusion_risk": number;
  "closed_cluster_density": number;
  "validator_diversity_score": number;
}>;
  "recent_alerts": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "recent_trace_replays": Array<{
  "event_id": string;
  "event_type": string;
  "subject_id": string;
  "trace_id": string | null;
  "created_at": string;
  "specversion": string;
  "type": string;
  "source": string;
  "subject": string;
  "id": string;
  "time": string;
  "datacontenttype": string;
  "data": {
  [key: string]: unknown;
};
}>;
  "observability": {
  "average_event_lag_ms": number;
  "last_trace_replay_at": string | null;
  "active_alerts": number;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};

export type ErrorEnvelope = {
  "error": {
  "code": "INVALID_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "METHOD_NOT_ALLOWED" | "PAYLOAD_TOO_LARGE" | "UNKNOWN_SUBJECT" | "PASSPORT_REVOKED" | "PASSPORT_SUSPENDED" | "INSUFFICIENT_EVIDENCE" | "LOW_CONFIDENCE" | "POLICY_BLOCKED" | "RATE_LIMITED" | "TRACE_UNAVAILABLE" | "CONFLICTING_EVIDENCE" | "TEMPORARY_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT";
  "message": string;
  "details": {
  [key: string]: unknown;
};
  "suggested_actions": Array<string>;
  "trace_id": string | null;
};
  "response_cost"?: {
  "compute_units": number;
  "estimated_tokens": number;
  "estimated_cost_usd": number;
  "response_bytes": number;
  "preset": "minimal" | "standard" | "explain" | "audit";
};
  "budget_hints"?: {
  "recommended_response_mode": "minimal" | "standard" | "explain" | "audit";
  "recommended_cache_ttl_s": number;
  "budget_remaining_units": number;
  "budget_status": "healthy" | "watch" | "constrained";
};
};
