function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(min, value, max) {
  return Math.max(min, Math.min(value, max));
}

function normalizeVerified(result, subjectId) {
  const confidence = Number(result?.confidence ?? 0.8);
  return {
    ...result,
    subject_id: result?.subject_id ?? subjectId,
    mode: "verified",
    provisional: false,
    confidence: Number(clamp(0.8, confidence, 1).toFixed(4))
  };
}

function normalizeDegradedFromCache(cachedResponse, reason, subjectId) {
  const score = Number(cachedResponse?.score ?? cachedResponse?.trust_score ?? 20);
  return {
    ...cachedResponse,
    subject_id: cachedResponse?.subject_id ?? subjectId,
    score,
    trust_score: score,
    trust_tier: cachedResponse?.trust_tier ?? "unverified",
    provisional: true,
    mode: "degraded",
    confidence: Number(Math.min(Number(cachedResponse?.confidence ?? 0.6), 0.6).toFixed(4)),
    reason
  };
}

function safeDefaultFallback(subjectId) {
  return {
    subject_id: subjectId,
    score: 20,
    trust_score: 20,
    trust_tier: "unverified",
    band: "quarantined",
    decision: "restrict",
    reason_codes: ["SAFE_DEFAULT_FALLBACK"],
    provisional: true,
    mode: "degraded",
    confidence: 0.25,
    reason: "SAFE_DEFAULT_FALLBACK"
  };
}

export async function resolveTrustWithResilience({
  subjectId,
  executeUpstream,
  cacheStore,
  logger,
  attemptTimeoutMs = 2000,
  retryDelaysMs = [250, 500, 1000]
}) {
  const started = Date.now();
  let lastError = null;
  let attempts = 0;

  for (let index = 0; index < retryDelaysMs.length; index += 1) {
    attempts += 1;
    const attemptStarted = Date.now();
    try {
      const upstream = await executeUpstream({ timeoutMs: attemptTimeoutMs, attempt: attempts });
      const verified = normalizeVerified(upstream, subjectId);
      await cacheStore?.setCachedTrustForSubject?.(subjectId, verified);
      logger?.info?.({
        event: "upstream_resilience",
        subject_id: subjectId,
        attempt_count: attempts,
        final_status: "success",
        fallback_used: false,
        latency_ms: Date.now() - started,
        attempt_latency_ms: Date.now() - attemptStarted
      });
      return verified;
    } catch (error) {
      lastError = error;
      const canRetry = index < retryDelaysMs.length - 1;
      logger?.warn?.({
        event: "upstream_resilience_attempt_failed",
        subject_id: subjectId,
        attempt_count: attempts,
        final_status: canRetry ? "retrying" : "failed",
        fallback_used: false,
        latency_ms: Date.now() - started,
        attempt_latency_ms: Date.now() - attemptStarted,
        error: error?.message ?? "upstream_request_failed"
      });
      if (canRetry) {
        await sleep(retryDelaysMs[index]);
      }
    }
  }

  const cached = await cacheStore?.getCachedTrustForSubject?.(subjectId);
  if (cached?.response && typeof cached.response === "object") {
    const degraded = normalizeDegradedFromCache(cached.response, "CACHED_TRUST_FALLBACK", subjectId);
    logger?.warn?.({
      event: "upstream_resilience",
      subject_id: subjectId,
      attempt_count: attempts,
      final_status: "fallback_cached",
      fallback_used: true,
      fallback_reason: "CACHED_TRUST_FALLBACK",
      latency_ms: Date.now() - started,
      last_error: lastError?.message ?? null
    });
    return degraded;
  }

  const safeDefault = safeDefaultFallback(subjectId);
  logger?.warn?.({
    event: "upstream_resilience",
    subject_id: subjectId,
    attempt_count: attempts,
    final_status: "fallback_safe_default",
    fallback_used: true,
    fallback_reason: "SAFE_DEFAULT_FALLBACK",
    latency_ms: Date.now() - started,
    last_error: lastError?.message ?? null
  });
  return safeDefault;
}
