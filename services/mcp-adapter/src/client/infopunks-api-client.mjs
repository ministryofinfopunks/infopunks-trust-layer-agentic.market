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

function truncate(value, max = 500) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parseTextBody(text) {
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
  constructor({ baseUrl, token, logger = null }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.logger = logger;
  }

  async request(method, route, { body, query, headers, adapterTraceId } = {}) {
    const url = `${this.baseUrl}${route}${queryString(query)}`;
    const requestBody = body ? JSON.stringify(body) : undefined;
    const requestHeaders = {
      accept: "application/json",
      authorization: `Bearer ${this.token}`,
      ...(adapterTraceId ? { "X-Adapter-Trace-Id": adapterTraceId } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(headers ?? {})
    };

    try {
      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: requestBody
      });
      const responseText = await response.text();
      const payload = parseTextBody(responseText);

      this.logger?.info?.({
        event: "upstream_request_completed",
        adapter_trace_id: adapterTraceId ?? null,
        method,
        url,
        status_code: response.status,
        response_preview: truncate(responseText),
        request_body_preview: truncate(requestBody ?? "")
      });

      if (!response.ok) {
        throw new UpstreamError(`${method} ${route} failed`, {
          status: response.status,
          body: payload,
          method,
          route
        });
      }

      return payload;
    } catch (error) {
      const cause = error?.cause;
      this.logger?.error?.({
        event: "upstream_request_failed",
        adapter_trace_id: adapterTraceId ?? null,
        method,
        url,
        request_body_preview: truncate(requestBody ?? ""),
        error_message: error?.message ?? "fetch failed",
        error_cause: cause?.message ?? String(cause ?? "")
      });
      throw error;
    }
  }

  health() {
    const url = `${this.baseUrl}/healthz`;
    return fetch(url)
      .then(async (res) => {
        const text = await res.text().catch(() => "");
        this.logger?.info?.({
          event: "upstream_health_probe",
          method: "GET",
          url,
          status_code: res.status,
          response_preview: truncate(text)
        });
        return res.ok;
      })
      .catch((error) => {
        const cause = error?.cause;
        this.logger?.warn?.({
          event: "upstream_health_probe_failed",
          method: "GET",
          url,
          error_message: error?.message ?? "fetch failed",
          error_cause: cause?.message ?? String(cause ?? "")
        });
        return false;
      });
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
