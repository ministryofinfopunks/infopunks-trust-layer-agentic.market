import crypto from "node:crypto";

const BAND_ORDER = [
  "quarantined",
  "restricted",
  "watch",
  "allowed",
  "preferred",
  "privileged"
];

export const TRUST_STATES = [
  "UNKNOWN",
  "VERIFIED",
  "DEGRADING",
  "RISKY",
  "COMPROMISED",
  "QUARANTINED"
];

export const TRUST_POLICY_ACTIONS = [
  "ALLOW",
  "RATE_LIMIT",
  "REQUIRE_ESCROW",
  "REQUIRE_SECONDARY_VALIDATION",
  "MANUAL_REVIEW",
  "BLOCK",
  "QUARANTINE"
];

const DEFAULT_TRUST_CONFIG = {
  decayHalfLifeHours: 72,
  minVerifiedScore: 80,
  riskyThreshold: 50,
  quarantineThreshold: 25,
  maxRecoveryPerEvent: 3,
  replayPenalty: 35,
  duplicatePaymentPenalty: 35,
  malformedPayloadPenalty: 20,
  verifierDelayPenalty: 10
};

const ADAPTIVE_EVENT_PENALTIES = {
  CLEAN_EXECUTION: { positive: 2 },
  PAYMENT_VERIFIED: { positive: 2 },
  PAYMENT_FAILED: { negative: 18 },
  REPLAY_ATTEMPT: { negativeKey: "replayPenalty" },
  DUPLICATE_PAYMENT_SIGNATURE: { negativeKey: "duplicatePaymentPenalty" },
  MALFORMED_PAYLOAD: { negativeKey: "malformedPayloadPenalty" },
  PAYLOAD_MISMATCH: { negative: 22 },
  VERIFIER_DELAY: { negativeKey: "verifierDelayPenalty" },
  RATE_SPIKE: { negative: 14 },
  OUTPUT_INCONSISTENCY: { negative: 16 },
  DEPENDENCY_FAILURE: { negative: 18 },
  MANUAL_OVERRIDE: { positive: 1 },
  QUARANTINE: { negative: 50 }
};

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

export function normalizeTrustConfig(overrides = {}) {
  const fromEnv = (name, fallback) => {
    const raw = process.env[name];
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return value;
  };
  return {
    decayHalfLifeHours: Number(overrides.decayHalfLifeHours ?? fromEnv("TRUST_DECAY_HALF_LIFE_HOURS", DEFAULT_TRUST_CONFIG.decayHalfLifeHours)),
    minVerifiedScore: Number(overrides.minVerifiedScore ?? fromEnv("TRUST_MIN_VERIFIED_SCORE", DEFAULT_TRUST_CONFIG.minVerifiedScore)),
    riskyThreshold: Number(overrides.riskyThreshold ?? fromEnv("TRUST_RISKY_THRESHOLD", DEFAULT_TRUST_CONFIG.riskyThreshold)),
    quarantineThreshold: Number(overrides.quarantineThreshold ?? fromEnv("TRUST_QUARANTINE_THRESHOLD", DEFAULT_TRUST_CONFIG.quarantineThreshold)),
    maxRecoveryPerEvent: Number(overrides.maxRecoveryPerEvent ?? fromEnv("TRUST_MAX_RECOVERY_PER_EVENT", DEFAULT_TRUST_CONFIG.maxRecoveryPerEvent)),
    replayPenalty: Number(overrides.replayPenalty ?? fromEnv("TRUST_REPLAY_PENALTY", DEFAULT_TRUST_CONFIG.replayPenalty)),
    duplicatePaymentPenalty: Number(overrides.duplicatePaymentPenalty ?? fromEnv("TRUST_DUPLICATE_PAYMENT_PENALTY", DEFAULT_TRUST_CONFIG.duplicatePaymentPenalty)),
    malformedPayloadPenalty: Number(overrides.malformedPayloadPenalty ?? fromEnv("TRUST_MALFORMED_PAYLOAD_PENALTY", DEFAULT_TRUST_CONFIG.malformedPayloadPenalty)),
    verifierDelayPenalty: Number(overrides.verifierDelayPenalty ?? fromEnv("TRUST_VERIFIER_DELAY_PENALTY", DEFAULT_TRUST_CONFIG.verifierDelayPenalty))
  };
}

function expFreshness(hours, halfLifeHours = 72) {
  const safeHalfLife = Math.max(1, Number(halfLifeHours) || 72);
  return round(Math.pow(0.5, hours / safeHalfLife));
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

function normalizeEventType(value) {
  return String(value ?? "")
    .trim()
    .replace(/[.\-]/g, "_")
    .toUpperCase();
}

function dependencySignals(passport = {}, recentWindow = []) {
  const dependencies = Array.isArray(passport?.metadata?.dependencies) ? passport.metadata.dependencies : [];
  const fromPassport = dependencies.map((entry) => {
    const state = String(entry?.state ?? "UNKNOWN").toUpperCase();
    const health = Number(entry?.health ?? entry?.score ?? 60);
    return { state, health };
  });
  const fromEvidence = recentWindow.flatMap((entry) => {
    const raw = entry?.context?.dependency_health;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }
    return Object.values(raw).map((value) => {
      if (typeof value === "number") {
        return { state: value < 40 ? "RISKY" : "VERIFIED", health: value };
      }
      if (value && typeof value === "object") {
        return { state: String(value.state ?? "UNKNOWN").toUpperCase(), health: Number(value.health ?? value.score ?? 60) };
      }
      return { state: "UNKNOWN", health: 60 };
    });
  });
  const all = [...fromPassport, ...fromEvidence];
  if (all.length === 0) {
    return { dependencyRisk: 0.2, dependencyCount: 0, riskyDependencies: 0 };
  }
  const riskyDependencies = all.filter((entry) => ["RISKY", "COMPROMISED", "QUARANTINED"].includes(entry.state)).length;
  const avgHealth = all.reduce((sum, entry) => sum + clamp(0, Number(entry.health ?? 60), 100), 0) / all.length;
  const statePenalty = riskyDependencies / all.length;
  const risk = clamp(0, 0.55 * (1 - avgHealth / 100) + 0.45 * statePenalty, 1);
  return {
    dependencyRisk: round(risk),
    dependencyCount: all.length,
    riskyDependencies
  };
}

function adversarialSignals(recentWindow = [], trustConfig = DEFAULT_TRUST_CONFIG) {
  const eventCounts = new Map();
  for (const entry of recentWindow) {
    const normalized = normalizeEventType(entry?.event_type);
    eventCounts.set(normalized, (eventCounts.get(normalized) ?? 0) + 1);
    if (normalized === "TASK_COMPLETED") {
      eventCounts.set("CLEAN_EXECUTION", (eventCounts.get("CLEAN_EXECUTION") ?? 0) + 1);
    }
  }

  let negative = 0;
  let positive = 0;
  for (const [eventType, count] of eventCounts.entries()) {
    const rule = ADAPTIVE_EVENT_PENALTIES[eventType];
    if (!rule) {
      continue;
    }
    const units = Math.max(1, count);
    if (rule.positive) {
      positive += Math.min(rule.positive, trustConfig.maxRecoveryPerEvent) * units;
    }
    const negativeValue = rule.negativeKey ? Number(trustConfig[rule.negativeKey] ?? 0) : Number(rule.negative ?? 0);
    negative += Math.max(0, negativeValue) * units;
  }
  const net = positive - negative;
  return {
    eventCounts: Object.fromEntries(eventCounts.entries()),
    negativeScore: round(negative, 2),
    positiveScore: round(positive, 2),
    netScore: round(net, 2),
    riskSignal: round(clamp(0, negative / 120, 1))
  };
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

export function computeSnapshot({ subjectId, passport, evidences, nowIso, previousSnapshot, policy, trustConfig: trustConfigOverrides = {} }) {
  const trustConfig = normalizeTrustConfig(trustConfigOverrides);
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
    const domainFreshness = expFreshness(stats.freshestHours, trustConfig.decayHalfLifeHours);
    domainCompetence[domain] = round(
      clamp(0, 0.5 * domainSuccess + 0.3 * domainQuality + 0.2 * domainFreshness, 1)
    );
  }

  const lastEventAt = ordered[0]?.created_at ?? passport.created_at;
  const freshness = ordered.length === 0 ? 0.2 : expFreshness(ageHours(lastEventAt, nowIso), trustConfig.decayHalfLifeHours);
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

  const dependency = dependencySignals(passport, recentWindow);
  const adversarial = adversarialSignals(mediumWindow, trustConfig);
  const behavioralStability = clamp(
    0,
    0.45 * coordinationStability +
      0.25 * (1 - anomalyWindowRisk) +
      0.2 * (1 - reversalAsymmetry) +
      0.1 * (1 - adversarial.riskSignal),
    1
  );
  const identityCredibility = clamp(
    0,
    0.65 * identityIntegrity +
      0.2 * (1 - sockpuppetRisk) +
      0.15 * (1 - issuerCorrelation),
    1
  );
  const economicIntegrity = clamp(
    0,
    0.4 * executionReliability +
      0.25 * validationQuality +
      0.2 * (1 - disputeRate) +
      0.15 * (1 - adversarial.riskSignal),
    1
  );
  const adversarialRisk = clamp(
    0,
    0.4 * graphSignals.collusion_risk +
      0.25 * sockpuppetRisk +
      0.2 * validatorBriberyRisk +
      0.15 * clamp(0, anomalyWindowRisk + adversarial.riskSignal * 0.7, 1),
    1
  );
  const trustVector = {
    executionReliability: Math.round(executionReliability * 100),
    economicIntegrity: Math.round(economicIntegrity * 100),
    identityCredibility: Math.round(identityCredibility * 100),
    behavioralStability: Math.round(behavioralStability * 100),
    dependencyRisk: Math.round(dependency.dependencyRisk * 100),
    adversarialRisk: Math.round(adversarialRisk * 100),
    evidenceFreshness: Math.round(freshness * 100),
    overallTrust: 0
  };

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
      task_value_weight: round(recentTaskValue),
      trust_vector_v1: trustVector,
      adversarial_penalty: adversarial.netScore,
      adversarial_event_counts: adversarial.eventCounts,
      dependency_count: dependency.dependencyCount,
      dependency_risky_count: dependency.riskyDependencies
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
    last_evidence_at: lastEventAt,
    updated_at: nowIso
  };
}

function mapActionToLegacyDecision(action, fallback = "allow_with_validation") {
  if (action === "ALLOW") {
    return "allow";
  }
  if (action === "BLOCK" || action === "QUARANTINE" || action === "MANUAL_REVIEW") {
    return "deny";
  }
  if (action === "RATE_LIMIT" || action === "REQUIRE_ESCROW" || action === "REQUIRE_SECONDARY_VALIDATION") {
    return "restrict";
  }
  return fallback;
}

function deriveTrustState(trustVector, score, trustConfig, rawVector = {}) {
  const adversarialEvents = rawVector.adversarial_event_counts ?? {};
  const quarantineSignals = Number(adversarialEvents.QUARANTINE ?? 0);
  if (quarantineSignals > 0 || trustVector.adversarialRisk >= 90 || score <= trustConfig.quarantineThreshold) {
    return "QUARANTINED";
  }
  if (trustVector.adversarialRisk >= 80 || score <= 35) {
    return "COMPROMISED";
  }
  if (score < trustConfig.riskyThreshold || trustVector.adversarialRisk >= 70) {
    return "RISKY";
  }
  if (trustVector.evidenceFreshness < 40 || trustVector.executionReliability < 50) {
    return "DEGRADING";
  }
  if (score >= trustConfig.minVerifiedScore && trustVector.adversarialRisk < 40) {
    return "VERIFIED";
  }
  return "UNKNOWN";
}

function derivePolicy(trustVector, trustState, reasonCodes = []) {
  let action = "ALLOW";
  if (trustState === "QUARANTINED") {
    action = "QUARANTINE";
  } else if (trustState === "COMPROMISED") {
    action = "BLOCK";
  } else if (trustState === "RISKY") {
    action = "REQUIRE_SECONDARY_VALIDATION";
  } else if (trustState === "DEGRADING") {
    action = "RATE_LIMIT";
  }
  if (trustVector.adversarialRisk > 70 && !["QUARANTINE", "BLOCK"].includes(action)) {
    action = "REQUIRE_SECONDARY_VALIDATION";
  }
  if (trustVector.economicIntegrity < 60 && action === "ALLOW") {
    action = "REQUIRE_ESCROW";
  }
  if (trustVector.executionReliability < 50 && action === "ALLOW") {
    action = "RATE_LIMIT";
  }

  const allow = !["BLOCK", "QUARANTINE"].includes(action);
  const policyReasonCodes = [...reasonCodes];
  if (trustVector.adversarialRisk > 70) {
    policyReasonCodes.push("adversarial_risk_elevated");
  }
  if (trustVector.economicIntegrity < 60) {
    policyReasonCodes.push("economic_integrity_low");
  }
  if (trustVector.executionReliability < 50) {
    policyReasonCodes.push("execution_reliability_low");
  }
  if (trustVector.evidenceFreshness < 40) {
    policyReasonCodes.push("evidence_freshness_low");
  }
  if (trustState === "QUARANTINED") {
    policyReasonCodes.push("state_quarantined");
  }

  const uniqueCodes = [...new Set(policyReasonCodes)];
  const routingPriority = Math.round(
    clamp(
      0,
      100 -
        trustVector.adversarialRisk * 0.45 -
        trustVector.dependencyRisk * 0.25 +
        trustVector.executionReliability * 0.2,
      100
    )
  );
  const maxRequestsPerMinute = action === "QUARANTINE"
    ? 0
    : action === "BLOCK"
      ? 1
      : action === "MANUAL_REVIEW"
        ? 4
        : action === "RATE_LIMIT"
          ? 20
          : action === "REQUIRE_SECONDARY_VALIDATION" || action === "REQUIRE_ESCROW"
            ? 40
            : 120;

  return {
    allow,
    action,
    routingPriority,
    maxRequestsPerMinute,
    escrowRequired: action === "REQUIRE_ESCROW" || trustVector.economicIntegrity < 60,
    secondaryValidationRequired: action === "REQUIRE_SECONDARY_VALIDATION" || trustVector.adversarialRisk > 70,
    reasonCodes: uniqueCodes,
    humanReadableSummary: `State ${trustState}: ${action.replaceAll("_", " ").toLowerCase()} due to ${uniqueCodes.join(", ") || "baseline policy"}.`
  };
}

export function computeResolution({ passport, snapshot, context, policy, nowIso, trustConfig: trustConfigOverrides = {} }) {
  const trustConfig = normalizeTrustConfig(trustConfigOverrides);
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
  const dependencyPenalty = 0.12 * Number(vector.trust_vector_v1?.dependencyRisk ?? 20);
  const adversarialPenalty = 0.15 * Number(vector.trust_vector_v1?.adversarialRisk ?? 20);
  const rawScore = base + identity + execution + validation + domainScore + freshness + stability - disputePenalty - collusionPenalty - decayPenalty - dependencyPenalty - adversarialPenalty;
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

  const trustVector = {
    executionReliability: Math.round(Number(vector.trust_vector_v1?.executionReliability ?? Number(vector.execution_reliability ?? 0) * 100)),
    economicIntegrity: Math.round(Number(vector.trust_vector_v1?.economicIntegrity ?? 55)),
    identityCredibility: Math.round(Number(vector.trust_vector_v1?.identityCredibility ?? Number(vector.identity_integrity ?? 0) * 100)),
    behavioralStability: Math.round(Number(vector.trust_vector_v1?.behavioralStability ?? Number(vector.coordination_stability ?? 0) * 100)),
    dependencyRisk: Math.round(Number(vector.trust_vector_v1?.dependencyRisk ?? 20)),
    adversarialRisk: Math.round(Number(vector.trust_vector_v1?.adversarialRisk ?? Number(vector.collusion_risk ?? 0) * 100)),
    evidenceFreshness: Math.round(Number(vector.trust_vector_v1?.evidenceFreshness ?? Number(vector.freshness ?? 0) * 100)),
    overallTrust: score
  };
  const trustState = deriveTrustState(trustVector, score, trustConfig, vector);
  const trustPolicyDecision = derivePolicy(trustVector, trustState, reasonCodes);
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
  if (!policyActions.includes(`policy_action:${trustPolicyDecision.action}`)) {
    policyActions.push(`policy_action:${trustPolicyDecision.action}`);
  }
  decision = mapActionToLegacyDecision(trustPolicyDecision.action, decision);

  return {
    score,
    band,
    confidence,
    decision,
    reason_codes: reasonCodes,
    policy_actions: policyActions,
    trust_state: trustState,
    trust_vector: trustVector,
    trust_policy: trustPolicyDecision,
    trust_evidence: {
      lastEvidenceAt: snapshot.last_evidence_at ?? snapshot.last_event_at ?? nowIso,
      sampleSize: Number(snapshot.aggregate_counts?.tasks_total ?? 0) + Number(snapshot.aggregate_counts?.validations_total ?? 0),
      recentEvents: Object.entries(vector.adversarial_event_counts ?? {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([eventType, count]) => ({ eventType, count }))
    },
    agentic_market: {
      serviceType: "trust-resolution",
      pricingHint: "x402-metered",
      x402Required: true,
      version: "trust-v1"
    },
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
      decay_adjustment: round(-(1 - Number(vector.freshness ?? 0))),
      dependency_penalty: round(-dependencyPenalty),
      adversarial_penalty: round(-adversarialPenalty)
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
  const extraEvents = [];
  if (previousResolution.trust_state && nextResolution.trust_state && previousResolution.trust_state !== nextResolution.trust_state) {
    if (nextResolution.trust_state === "QUARANTINED") {
      extraEvents.push({
        type: "AGENT_QUARANTINED",
        severity: "CRITICAL"
      });
    }
    if (["COMPROMISED", "QUARANTINED"].includes(nextResolution.trust_state)) {
      extraEvents.push({
        type: "TRUST_COLLAPSE",
        severity: "CRITICAL"
      });
    }
  }
  if (previousResolution.trust_policy?.action && nextResolution.trust_policy?.action &&
    previousResolution.trust_policy.action !== nextResolution.trust_policy.action) {
    extraEvents.push({
      type: "POLICY_ACTION_CHANGED",
      severity: "WARNING"
    });
    if (nextResolution.trust_policy.action === "RATE_LIMIT") {
      extraEvents.push({
        type: "AGENT_RATE_LIMITED",
        severity: "WARNING"
      });
    }
    if (nextResolution.trust_policy.action === "REQUIRE_ESCROW") {
      extraEvents.push({
        type: "AGENT_ESCROW_REQUIRED",
        severity: "WARNING"
      });
    }
  }
  if (
    Number.isFinite(previousResolution.trust_policy?.routingPriority) &&
    Number.isFinite(nextResolution.trust_policy?.routingPriority) &&
    Math.abs(nextResolution.trust_policy.routingPriority - previousResolution.trust_policy.routingPriority) >= 10
  ) {
    extraEvents.push({
      type: "ROUTING_PRIORITY_CHANGED",
      severity: "INFO"
    });
  }
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
      },
      extra_events: [{ type: "TRUST_SPIKE", severity: "INFO" }, ...extraEvents]
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
      },
      extra_events: [{ type: "TRUST_COLLAPSE", severity: "CRITICAL" }, ...extraEvents]
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
      },
      extra_events: extraEvents
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
      },
      extra_events: [{ type: "TRUST_DECAY", severity: "WARNING" }, ...extraEvents]
    };
  }
  if (extraEvents.length > 0) {
    return {
      type: "trust.recovered",
      data: {
        prior_score: previousResolution.score,
        new_score: nextResolution.score,
        delta,
        severity: "low",
        trigger: { kind: "policy_only", evidence_id: evidenceId ?? null },
        context,
        recommended_actions: []
      },
      extra_events: extraEvents
    };
  }
  return null;
}

export function validationEligible(band, context, policy) {
  const riskLevel = context?.risk_level ?? "medium";
  const rule = policy.risk_rules[riskLevel] ?? policy.risk_rules.medium;
  return bandAtLeast(band, rule.minimum_band_for_validation);
}
