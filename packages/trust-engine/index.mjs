import crypto from "node:crypto";

const BAND_ORDER = [
  "quarantined",
  "restricted",
  "watch",
  "allowed",
  "preferred",
  "privileged"
];

function clamp(min, value, max) {
  return Math.max(min, Math.min(value, max));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreBand(score, policy) {
  for (const [band, range] of Object.entries(policy.trust_bands)) {
    if (score >= range.min && score <= range.max) {
      return band;
    }
  }
  return "quarantined";
}

function bandAtLeast(current, minimum) {
  return BAND_ORDER.indexOf(current) >= BAND_ORDER.indexOf(minimum);
}

function ageHours(createdAt, nowIso) {
  const delta = new Date(nowIso).getTime() - new Date(createdAt).getTime();
  return Math.max(0, delta / (1000 * 60 * 60));
}

function expFreshness(hours) {
  return round(Math.exp(-hours / 48));
}

function rollingWeights(items) {
  return items.map((item, index) => ({ item, weight: 1 - index / Math.max(1, items.length + 1) }));
}

function averageWeighted(values) {
  const weighted = values.reduce(
    (acc, entry) => {
      acc.numerator += entry.value * entry.weight;
      acc.denominator += entry.weight;
      return acc;
    },
    { numerator: 0, denominator: 0 }
  );
  return weighted.denominator === 0 ? 0 : weighted.numerator / weighted.denominator;
}

function buildDomainStats(evidences, nowIso) {
  const stats = new Map();
  for (const evidence of evidences) {
    const domain = evidence.context?.domain;
    if (!domain) {
      continue;
    }
    const bucket = stats.get(domain) ?? {
      total: 0,
      success: 0,
      validatedQuality: [],
      freshestHours: 9999
    };
    bucket.total += 1;
    if (evidence.event_type === "task.completed") {
      bucket.success += 1;
    }
    const quality = Number(evidence.outcome?.quality_score ?? 0);
    const confidence = Number(evidence.outcome?.confidence_score ?? 0);
    bucket.validatedQuality.push((quality + confidence) / 2);
    bucket.freshestHours = Math.min(bucket.freshestHours, ageHours(evidence.created_at, nowIso));
    stats.set(domain, bucket);
  }
  return stats;
}

function computeTaskValueWeight(evidence) {
  const context = evidence.context ?? {};
  const outcome = evidence.outcome ?? {};
  const riskLevel = context.risk_level ?? "medium";
  const baseRisk = riskLevel === "high" ? 1.25 : riskLevel === "low" ? 0.85 : 1;
  const difficulty = clamp(0.7, Number(context.difficulty_score ?? 1), 2);
  const capitalExposure = Number(context.capital_exposure_usd ?? 0);
  const economicExposure = 1 + clamp(0, Math.log10(capitalExposure + 1) / 5, 0.6);
  const uncertainty = 0.85 + clamp(0, Number(context.uncertainty_score ?? (1 - Number(outcome.confidence_score ?? 0.5))), 1) * 0.35;
  const externalVerifiability = context.requires_external_verification ? 1.15 : 1;
  const downstreamImpact = 1 + clamp(0, Number(context.downstream_impact_score ?? 0), 1) * 0.3;
  const validatorDiversity = 1 + clamp(0, new Set((evidence.validators ?? []).map((entry) => entry.validator_id)).size / 3, 1) * 0.15;
  const bootstrapPenalty = String(context.task_type ?? "").includes("bootstrap") ? 0.8 : 1;
  return round(clamp(0.5, baseRisk * difficulty * economicExposure * uncertainty * externalVerifiability * downstreamImpact * validatorDiversity * bootstrapPenalty, 3));
}

function computeGraphSignals(subjectId, evidences, recentWindow, policy, passport, validatorPassports = {}) {
  const validatorIds = [];
  const pairCounts = new Map();
  let reversals = 0;
  let sharedIssuerMatches = 0;
  let sharedInfraMatches = 0;

  for (const evidence of evidences) {
    const validators = evidence.validators ?? [];
    for (const validator of validators) {
      validatorIds.push(validator.validator_id);
      const pair = `${subjectId}::${validator.validator_id}`;
      pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      const validatorPassport = validatorPassports[validator.validator_id];
      const issuerId = validatorPassport?.issuer?.issuer_id;
      const sameOwner =
        passport?.metadata?.owner_org &&
        validatorPassport?.metadata?.owner_org &&
        passport.metadata.owner_org === validatorPassport.metadata.owner_org;
      if (issuerId && issuerId === passport?.issuer?.issuer_id && (issuerId !== "org_infopunks" || sameOwner)) {
        sharedIssuerMatches += 1;
      }
      const subjectOwner = passport?.metadata?.owner_org;
      const validatorOwner = validatorPassport?.metadata?.owner_org;
      const subjectFramework = passport?.metadata?.framework;
      const validatorFramework = validatorPassport?.metadata?.framework;
      if (
        (subjectOwner && validatorOwner && subjectOwner === validatorOwner) ||
        (subjectFramework && validatorFramework && subjectFramework === validatorFramework)
      ) {
        sharedInfraMatches += 1;
      }
    }
    if (evidence.event_type === "validation.reversed") {
      reversals += 1;
    }
  }

  const totalValidations = validatorIds.length;
  const distinctValidators = new Set(validatorIds);
  const validatorDiversityScore = clamp(
    0,
    distinctValidators.size / Math.max(1, policy.thresholds.minimum_validator_diversity),
    1
  );

  let repeatedPairInteractions = 0;
  for (const count of pairCounts.values()) {
    if (count > 1) {
      repeatedPairInteractions += count - 1;
    }
  }

  const mutualValidationRatio = totalValidations === 0 ? 0 : repeatedPairInteractions / totalValidations;
  const clusterCounts = [...distinctValidators].map((validatorId) => ({
    validatorId,
    count: validatorIds.filter((entry) => entry === validatorId).length
  }));
  clusterCounts.sort((a, b) => b.count - a.count || a.validatorId.localeCompare(b.validatorId));
  const dominantClusterCount = clusterCounts.slice(0, 2).reduce((sum, entry) => sum + entry.count, 0);
  const closedClusterDensity = totalValidations === 0 ? 0 : dominantClusterCount / totalValidations;
  const sharedClusterDependency = closedClusterDensity;
  const reversalRate = totalValidations === 0 ? 0 : reversals / Math.max(1, totalValidations);
  const sharedIssuerRatio = totalValidations === 0 ? 0 : sharedIssuerMatches / totalValidations;
  const sharedInfraRatio = totalValidations === 0 ? 0 : sharedInfraMatches / totalValidations;

  const collusionRisk = clamp(
    0,
    0.4 * mutualValidationRatio +
      0.2 * closedClusterDensity +
      0.15 * (1 - validatorDiversityScore) +
      0.15 * sharedIssuerRatio +
      0.1 * sharedInfraRatio,
    1
  );

  return {
    mutual_validation_ratio: round(mutualValidationRatio),
    validator_diversity_score: round(validatorDiversityScore),
    closed_cluster_density: round(closedClusterDensity),
    reversal_rate: round(reversalRate),
    shared_cluster_dependency: round(sharedClusterDependency),
    shared_issuer_ratio: round(sharedIssuerRatio),
    shared_infra_ratio: round(sharedInfraRatio),
    collusion_risk: round(collusionRisk)
  };
}

export function stableHash(value) {
  return `ctx_${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 10)}`;
}

export function computeSnapshot({ subjectId, passport, evidences, nowIso, previousSnapshot, policy }) {
  const ordered = [...evidences].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || a.evidence_id.localeCompare(b.evidence_id)
  );
  const recentWindow = ordered.slice(0, 20);
  const mediumWindow = ordered.slice(0, 100);
  const weightedRecent = rollingWeights(recentWindow);
  const weightedTasks = weightedRecent
    .filter(({ item }) => item.event_type.startsWith("task."))
    .map(({ item, weight }) => ({
      item,
      weight: weight * computeTaskValueWeight(item)
    }));
  const taskEvents = mediumWindow.filter((entry) => entry.event_type.startsWith("task."));
  const successEvents = taskEvents.filter((entry) => entry.event_type === "task.completed");
  const failedEvents = taskEvents.filter((entry) => entry.event_type === "task.failed");
  const timeoutEvents = taskEvents.filter((entry) => entry.event_type === "task.timeout");
  const validationEvents = mediumWindow.filter((entry) => entry.event_type.startsWith("validation."));
  const disputeEvents = mediumWindow.filter((entry) => entry.event_type.startsWith("dispute."));
  const reversalEvents = mediumWindow.filter((entry) => entry.event_type === "validation.reversed");
  const domainStats = buildDomainStats(mediumWindow, nowIso);

  const taskWeightTotal = weightedTasks.reduce((sum, entry) => sum + entry.weight, 0);
  const successRate =
    weightedTasks.length === 0
      ? 0.5
      : weightedTasks.reduce((sum, entry) => sum + (entry.item.event_type === "task.completed" ? entry.weight : 0), 0) /
        Math.max(1, taskWeightTotal);
  const latencyCompliance = averageWeighted(
    weightedTasks.map(({ item, weight }) => ({
        value: Number(item.outcome?.latency_ms ?? 10000) <= 2500 ? 1 : 0.4,
        weight
      }))
  );
  const qualityAvg = averageWeighted(
    weightedTasks.map(({ item, weight }) => ({
        value: clamp(0, Number(item.outcome?.quality_score ?? 0.5), 1),
        weight
      }))
  );
  const confidenceAvg = averageWeighted(
    weightedTasks.map(({ item, weight }) => ({
        value: clamp(0, Number(item.outcome?.confidence_score ?? 0.5), 1),
        weight
      }))
  );
  const executionReliability = clamp(
    0,
    0.35 * successRate +
      0.3 * qualityAvg +
      0.2 * confidenceAvg +
      0.15 * latencyCompliance,
    1
  );

  const validationAccuracy =
    validationEvents.length === 0
      ? 0.5
      : clamp(
          0,
          (validationEvents.filter((entry) => entry.event_type === "validation.passed").length +
            recentWindow.filter((entry) => (entry.validators ?? []).some((validator) => validator.verdict === "pass")).length) /
            (validationEvents.length + Math.max(1, recentWindow.length)),
          1
        );
  const consensusAgreement =
    recentWindow.length === 0
      ? 0.5
      : averageWeighted(
          recentWindow.map((entry, index) => ({
            value:
              (entry.validators ?? []).length === 0
                ? 0.5
                : (entry.validators ?? []).filter((validator) => validator.verdict === "pass").length /
                  Math.max(1, (entry.validators ?? []).length),
            weight: 1 - index / Math.max(1, recentWindow.length + 1)
          }))
        );
  const validatorPassports = Object.fromEntries(
    Object.entries(passport?.related_validator_passports ?? {}).map(([key, value]) => [key, value])
  );
  const graphSignals = computeGraphSignals(subjectId, mediumWindow, recentWindow, policy, passport, validatorPassports);
  const reversalResilience = clamp(0, 1 - graphSignals.reversal_rate, 1);
  const reversalAsymmetry = clamp(0, graphSignals.reversal_rate * 1.4 + disputeEvents.length / Math.max(1, mediumWindow.length), 1);
  const recentTaskValue =
    weightedTasks.length === 0
      ? 1
      : weightedTasks.reduce((sum, entry) => sum + computeTaskValueWeight(entry.item), 0) / weightedTasks.length;
  const highValueLowDiversitySignal = clamp(
    0,
    Math.max(0, recentTaskValue - 1) * (1 - graphSignals.validator_diversity_score),
    1
  );
  const lowDiversityCap =
    graphSignals.validator_diversity_score < 1
      ? clamp(0.35, 0.55 + graphSignals.validator_diversity_score * 0.45, 1)
      : 1;
  const validationQuality = clamp(
    0,
    (0.45 * validationAccuracy +
      0.25 * consensusAgreement +
      0.2 * graphSignals.validator_diversity_score +
      0.1 * reversalResilience) * lowDiversityCap,
    1
  );

  const domainCompetence = {};
  for (const [domain, stats] of domainStats.entries()) {
    const domainSuccess = stats.total === 0 ? 0.2 : stats.success / stats.total;
    const domainQuality =
      stats.validatedQuality.length === 0
        ? 0.3
        : stats.validatedQuality.reduce((sum, value) => sum + value, 0) / stats.validatedQuality.length;
    const domainFreshness = expFreshness(stats.freshestHours);
    domainCompetence[domain] = round(
      clamp(0, 0.5 * domainSuccess + 0.3 * domainQuality + 0.2 * domainFreshness, 1)
    );
  }

  const lastEventAt = ordered[0]?.created_at ?? passport.created_at;
  const freshness = ordered.length === 0 ? 0.2 : expFreshness(ageHours(lastEventAt, nowIso));
  const previousExecution = Number(previousSnapshot?.vector?.execution_reliability ?? executionReliability);
  const volatility = Math.abs(previousExecution - executionReliability);
  const coordinationStability = clamp(0, 1 - volatility, 1);
  const disputeRate = clamp(0, disputeEvents.length / Math.max(1, mediumWindow.length), 1);
  const identityIntegrity = passport.status === "active" ? 0.96 : passport.status === "suspended" ? 0.35 : 0;
  const issuerCorrelation = graphSignals.shared_issuer_ratio;
  const sockpuppetRisk = clamp(
    0,
    0.45 * graphSignals.shared_issuer_ratio +
      0.35 * graphSignals.shared_infra_ratio +
      0.2 * (1 - graphSignals.validator_diversity_score),
    1
  );
  const validatorBriberyRisk = clamp(
    0,
    0.45 * highValueLowDiversitySignal +
      0.3 * graphSignals.mutual_validation_ratio +
      0.25 * graphSignals.reversal_rate,
    1
  );
  const anomalyWindowRisk = clamp(
    0,
    0.4 * volatility +
      0.3 * highValueLowDiversitySignal +
      0.2 * graphSignals.closed_cluster_density +
      0.1 * graphSignals.shared_cluster_dependency,
    1
  );

  return {
    subject_id: subjectId,
    snapshot_version: Number(previousSnapshot?.snapshot_version ?? 0) + 1,
    vector: {
      identity_integrity: round(identityIntegrity),
      execution_reliability: round(executionReliability),
      validation_quality: round(validationQuality),
      coordination_stability: round(coordinationStability),
      domain_competence: domainCompetence,
      dispute_rate: round(disputeRate),
      collusion_risk: graphSignals.collusion_risk,
      freshness: round(freshness),
      mutual_validation_ratio: graphSignals.mutual_validation_ratio,
      validator_diversity_score: graphSignals.validator_diversity_score,
      closed_cluster_density: graphSignals.closed_cluster_density,
      shared_cluster_dependency: graphSignals.shared_cluster_dependency,
      reversal_rate: graphSignals.reversal_rate,
      shared_issuer_ratio: graphSignals.shared_issuer_ratio,
      shared_infra_ratio: graphSignals.shared_infra_ratio,
      reversal_asymmetry: round(reversalAsymmetry),
      issuer_correlation: round(issuerCorrelation),
      sockpuppet_risk: round(sockpuppetRisk),
      validator_bribery_risk: round(validatorBriberyRisk),
      anomaly_window_risk: round(anomalyWindowRisk),
      task_value_weight: round(recentTaskValue)
    },
    aggregate_counts: {
      tasks_total: taskEvents.length,
      tasks_success: successEvents.length,
      tasks_failed: failedEvents.length + timeoutEvents.length,
      validations_total: validationEvents.length + mediumWindow.reduce((sum, entry) => sum + (entry.validators ?? []).length, 0),
      reversals_total: reversalEvents.length,
      disputes_total: disputeEvents.length
    },
    last_event_at: lastEventAt,
    updated_at: nowIso
  };
}

export function computeResolution({ passport, snapshot, context, policy, nowIso }) {
  const base = 20;
  const domain = context?.domain;
  const vector = snapshot.vector;
  const domainEvidenceExists = Boolean(domain && Object.prototype.hasOwnProperty.call(vector.domain_competence ?? {}, domain));
  const domainFit = domain ? Number(vector.domain_competence?.[domain] ?? 0.12) : 0.35;
  const identity = 15 * Number(vector.identity_integrity ?? 0);
  const execution = 20 * Number(vector.execution_reliability ?? 0);
  const validation = 15 * Number(vector.validation_quality ?? 0);
  const domainScore = 15 * domainFit;
  const freshness = 10 * Number(vector.freshness ?? 0);
  const stability = 10 * Number(vector.coordination_stability ?? 0);
  const disputePenalty = 20 * Number(vector.dispute_rate ?? 0) + 12 * Number(vector.reversal_asymmetry ?? 0);
  const collusionPenalty =
    25 *
    clamp(
      0,
      0.55 * Number(vector.collusion_risk ?? 0) +
        0.2 * Number(vector.sockpuppet_risk ?? 0) +
        0.15 * Number(vector.validator_bribery_risk ?? 0) +
        0.1 * Number(vector.anomaly_window_risk ?? 0),
      1
    );
  const decayPenalty = 10 * (1 - Number(vector.freshness ?? 0));
  const rawScore = base + identity + execution + validation + domainScore + freshness + stability - disputePenalty - collusionPenalty - decayPenalty;
  const score = Math.round(clamp(0, rawScore, 100));
  const band = scoreBand(score, policy);
  const riskLevel = context?.risk_level ?? "medium";
  const rule = policy.risk_rules[riskLevel] ?? policy.risk_rules.medium;
  const lowConfidenceMinimum = riskLevel === "high" ? policy.thresholds.minimum_confidence_high_risk : 0.4;

  const evidenceVolume = clamp(
    0,
    Number(snapshot.aggregate_counts.tasks_total ?? 0) / 20 +
      Number(snapshot.aggregate_counts.validations_total ?? 0) / 20,
    1
  );
  const contradiction = clamp(
    0,
    Number(vector.dispute_rate ?? 0) +
      Number(vector.reversal_rate ?? 0) * 0.5 +
      Number(vector.sockpuppet_risk ?? 0) * 0.2 +
      Number(vector.anomaly_window_risk ?? 0) * 0.15,
    1
  );
  const confidence = round(
    clamp(
      0,
      0.35 * evidenceVolume +
        0.2 * Number(vector.freshness ?? 0) +
        0.2 * Number(vector.validator_diversity_score ?? 0) +
        0.15 * domainFit +
        0.1 * (1 - contradiction),
      1
    ),
    2
  );

  let decision;
  if (!bandAtLeast(band, rule.minimum_band_for_execution)) {
    decision = riskLevel === "high" && band === "restricted" ? "deny" : "restrict";
  } else {
    const mapping = {
      privileged: { low: "allow", medium: "allow", high: "allow" },
      preferred: { low: "allow", medium: "allow", high: "allow_with_validation" },
      allowed: { low: "allow", medium: "allow_with_validation", high: "allow_with_validation" },
      watch: { low: "allow_with_validation", medium: "allow_with_validation", high: "restrict" },
      restricted: { low: "restrict", medium: "restrict", high: "deny" },
      quarantined: { low: "deny", medium: "deny", high: "deny" }
    };
    decision = mapping[band][riskLevel];
  }

  const reasonCodes = [];
  if (domainFit >= 0.7 && domain) {
    reasonCodes.push(`domain_strength_${domain}`);
  }
  if (domain && !domainEvidenceExists) {
    reasonCodes.push("domain_evidence_sparse");
  }
  if (vector.collusion_risk <= 0.2) {
    reasonCodes.push("low_collusion_risk");
  }
  if (vector.reversal_rate > 0.15) {
    reasonCodes.push("recent_validator_reversal");
  }
  if (vector.reversal_asymmetry > 0.18) {
    reasonCodes.push("reversal_asymmetry_penalty");
  }
  if (vector.freshness > 0.65) {
    reasonCodes.push("fresh_evidence_available");
  }
  if (vector.collusion_risk > 0.45) {
    reasonCodes.push("collusion_risk_elevated");
  }
  if (vector.shared_issuer_ratio > 0.2) {
    reasonCodes.push("shared_issuer_dependency");
  }
  if (vector.shared_infra_ratio > 0.2) {
    reasonCodes.push("shared_infra_dependency");
  }
  if (vector.sockpuppet_risk > 0.4) {
    reasonCodes.push("sockpuppet_risk_elevated");
  }
  if (vector.validator_bribery_risk > 0.35) {
    reasonCodes.push("validator_bribery_signal");
  }
  if (vector.anomaly_window_risk > 0.35) {
    reasonCodes.push("anomaly_window_risk_elevated");
  }
  if (confidence < lowConfidenceMinimum) {
    reasonCodes.push("low_confidence_surface");
    if (decision === "allow") {
      decision = "allow_with_validation";
    }
  }
  if (reasonCodes.length === 0) {
    reasonCodes.push("baseline_policy_applied");
  }

  const policyActions = [...(policy.actions[band] ?? [])];
  if (decision === "allow_with_validation" && !policyActions.includes("require_dual_validation")) {
    policyActions.push("require_dual_validation");
  }
  if (confidence < lowConfidenceMinimum && !policyActions.includes("expand_evidence_window")) {
    policyActions.push("expand_evidence_window");
  }
  if (band === "quarantined" && !policyActions.includes("quarantine_subject")) {
    policyActions.push("quarantine_subject");
  }

  return {
    score,
    band,
    confidence,
    decision,
    reason_codes: reasonCodes,
    policy_actions: policyActions,
    score_breakdown: {
      identity_integrity: round(Number(vector.identity_integrity ?? 0)),
      task_outcome_quality: round(Number(vector.execution_reliability ?? 0)),
      validator_consensus: round(Number(vector.validation_quality ?? 0)),
      domain_fit: round(domainFit),
      freshness: round(Number(vector.freshness ?? 0)),
      longitudinal_consistency: round(Number(vector.coordination_stability ?? 0)),
      dispute_penalty: round(-Number(vector.dispute_rate ?? 0)),
      collusion_penalty: round(-Number(vector.collusion_risk ?? 0)),
      reversal_asymmetry_penalty: round(-Number(vector.reversal_asymmetry ?? 0)),
      sockpuppet_penalty: round(-Number(vector.sockpuppet_risk ?? 0)),
      validator_bribery_penalty: round(-Number(vector.validator_bribery_risk ?? 0)),
      anomaly_window_penalty: round(-Number(vector.anomaly_window_risk ?? 0)),
      decay_adjustment: round(-(1 - Number(vector.freshness ?? 0)))
    },
    engine_version: "trust-engine@1.0.0",
    policy_version: `${policy.policy_id}@${policy.version}`,
    expires_at: new Date(new Date(nowIso).getTime() + 5 * 60 * 1000).toISOString()
  };
}

export function computeTrustEvent(previousResolution, nextResolution, evidenceId, nowIso, context = {}) {
  if (!previousResolution) {
    return null;
  }
  const delta = nextResolution.score - previousResolution.score;
  if (delta >= 10) {
    return {
      type: "trust.spike",
      data: {
        prior_score: previousResolution.score,
        new_score: nextResolution.score,
        delta,
        severity: "moderate",
        trigger: { kind: "evidence_delta", evidence_id: evidenceId ?? null },
        context,
        recommended_actions: ["expand_execution_scope"]
      }
    };
  }
  if (delta <= -15 || ["restricted", "quarantined"].includes(nextResolution.band)) {
    const severity = nextResolution.band === "quarantined" ? "critical" : "high";
    const actions = ["reroute_pending_tasks", "escalate_to_war_room"];
    if (nextResolution.band === "quarantined") {
      actions.unshift("quarantine_subject");
    }
    return {
      type: "trust.collapse",
      data: {
        prior_score: previousResolution.score,
        new_score: nextResolution.score,
        delta,
        severity,
        trigger: { kind: "validator_reversal", evidence_id: evidenceId ?? null },
        context,
        recommended_actions: actions
      }
    };
  }
  if (
    ["watch", "restricted"].includes(previousResolution.band) &&
    ["allowed", "preferred", "privileged"].includes(nextResolution.band)
  ) {
    return {
      type: "trust.recovered",
      data: {
        prior_score: previousResolution.score,
        new_score: nextResolution.score,
        delta,
        severity: "moderate",
        trigger: { kind: "recovery", evidence_id: evidenceId ?? null },
        context,
        recommended_actions: ["restore_standard_routing"]
      }
    };
  }
  if (nextResolution.score < previousResolution.score && nextResolution.reason_codes.includes("fresh_evidence_available") === false) {
    return {
      type: "trust.decayed",
      data: {
        prior_score: previousResolution.score,
        new_score: nextResolution.score,
        delta,
        severity: "low",
        trigger: { kind: "decay", evidence_id: evidenceId ?? null },
        context,
        recommended_actions: ["refresh_domain_evidence"]
      }
    };
  }
  return null;
}

export function validationEligible(band, context, policy) {
  const riskLevel = context?.risk_level ?? "medium";
  const rule = policy.risk_rules[riskLevel] ?? policy.risk_rules.medium;
  return bandAtLeast(band, rule.minimum_band_for_validation);
}
