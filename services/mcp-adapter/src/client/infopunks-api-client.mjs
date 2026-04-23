function queryString(query = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class UpstreamError extends Error {
  constructor(message, { status, body, method, route }) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.body = body;
    this.method = method;
    this.route = route;
    this.code = body?.error?.code ?? "UPSTREAM_UNAVAILABLE";
  }
}

export class InfopunksApiClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  async request(method, route, { body, query, headers, adapterTraceId } = {}) {
    const response = await fetch(`${this.baseUrl}${route}${queryString(query)}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        ...(adapterTraceId ? { "X-Adapter-Trace-Id": adapterTraceId } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(headers ?? {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await parseBody(response);
    if (!response.ok) {
      throw new UpstreamError(`${method} ${route} failed`, {
        status: response.status,
        body: payload,
        method,
        route
      });
    }

    return payload;
  }

  health() {
    return fetch(`${this.baseUrl}/healthz`).then((res) => res.ok).catch(() => false);
  }

  getPassport(subjectId, adapterTraceId) { return this.request("GET", `/v1/passports/${encodeURIComponent(subjectId)}`, { adapterTraceId }); }
  createPassport(input, idempotencyKey) {
    return this.request("POST", "/v1/passports", {
      body: input,
      headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {}
    });
  }
  resolveTrust(input, adapterTraceId) { return this.request("POST", "/v1/trust/resolve", { body: input, adapterTraceId }); }
  selectValidators(input, adapterTraceId) { return this.request("POST", "/v1/routing/select-validator", { body: input, adapterTraceId }); }
  selectExecutor(input, adapterTraceId) { return this.request("POST", "/v1/routing/select-executor", { body: input, adapterTraceId }); }
  evaluateDispute(input, adapterTraceId) { return this.request("POST", "/v1/disputes/evaluate", { body: input, adapterTraceId }); }
  recordEvidence(input, adapterTraceId) { return this.request("POST", "/v1/evidence", { body: input, adapterTraceId }); }
  getTraceReplay(traceId, adapterTraceId) { return this.request("GET", `/v1/traces/${encodeURIComponent(traceId)}`, { adapterTraceId }); }
  getTrustExplanation(subjectId, contextHash, adapterTraceId) {
    return this.request("GET", `/v1/trust/${encodeURIComponent(subjectId)}/explain`, {
      adapterTraceId,
      query: { context_hash: contextHash ?? undefined }
    });
  }
  getPromptPack(name, adapterTraceId) { return this.request("GET", `/v1/prompts/${encodeURIComponent(name)}`, { adapterTraceId }); }
  exportPortability(input, adapterTraceId) { return this.request("POST", "/v1/portability/export", { body: input, adapterTraceId }); }
  importPortability(input, adapterTraceId) { return this.request("POST", "/v1/portability/import", { body: input, adapterTraceId }); }
  quoteRisk(input, adapterTraceId) { return this.request("POST", "/v1/economic/risk-price", { body: input, adapterTraceId }); }
  warRoomState(adapterTraceId) { return this.request("GET", "/v1/war-room/state", { adapterTraceId }); }
}
