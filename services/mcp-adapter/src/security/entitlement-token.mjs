import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { makeAdapterError } from "../schemas/error-schema.mjs";

const SUPPORTED_ALGORITHMS = new Set(["HS256", "RS256"]);

function base64UrlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${pad}`, "base64");
}

function decodeJwt(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) {
    throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Malformed entitlement token.", {}, false, 401);
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  try {
    const header = JSON.parse(base64UrlToBuffer(encodedHeader).toString("utf8"));
    const payload = JSON.parse(base64UrlToBuffer(encodedPayload).toString("utf8"));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    return {
      header,
      payload,
      signature: base64UrlToBuffer(encodedSignature),
      signingInput
    };
  } catch {
    throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Malformed entitlement token.", {}, false, 401);
  }
}

function verifyHs256(decoded, secret) {
  const { signingInput, signature } = decoded;
  const expected = createHmac("sha256", secret).update(signingInput).digest();
  return expected.length === signature.length && timingSafeEqual(expected, signature);
}

function verifyRs256(decoded, publicKeyPem) {
  const { signingInput, signature } = decoded;
  const key = createPublicKey(publicKeyPem);
  return verifySignature("RSA-SHA256", Buffer.from(signingInput), key, signature);
}

function normalizeScopeTokens(scopes) {
  if (Array.isArray(scopes)) {
    return scopes
      .flatMap((entry) => String(entry ?? "").split(/\s+/))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof scopes === "string") {
    return scopes
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function scopeIncludes(scopes, toolName) {
  const tokens = normalizeScopeTokens(scopes);
  if (tokens.length === 0) {
    return false;
  }
  const scopedName = `mcp:${toolName}`;
  const toolScopedName = `tool:${toolName}`;
  return tokens.includes("*") || tokens.includes("mcp:*") || tokens.includes(toolName) || tokens.includes(scopedName) || tokens.includes(toolScopedName);
}

function normalizeAudiences(aud) {
  if (Array.isArray(aud)) {
    return aud.map((value) => String(value)).filter(Boolean);
  }
  if (typeof aud === "string" && aud.trim().length > 0) {
    return [aud.trim()];
  }
  return [];
}

export class EntitlementTokenValidator {
  constructor({ config, store, logger }) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  extractToken(transportContext = {}) {
    const authHeader = transportContext.headers?.authorization ?? transportContext.headers?.Authorization;
    const explicitEntitlement = transportContext.headers?.["x-entitlement-token"];
    const bearerToken =
      typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : null;
    const explicitToken = typeof explicitEntitlement === "string" ? explicitEntitlement.trim() : null;
    if (bearerToken && explicitToken && bearerToken !== explicitToken) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Conflicting entitlement token headers.",
        {},
        false,
        401
      );
    }
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      return authHeader.slice(7).trim();
    }
    if (typeof explicitEntitlement === "string") {
      return explicitEntitlement.trim();
    }
    return null;
  }

  async validate({ token, toolName, adapterTraceId, callerContext = null, paymentContext = null, required = false }) {
    if (!token) {
      const mustHaveToken = required || this.config.entitlementTokenRequired;
      if (mustHaveToken || !this.config.entitlementFallbackAllow) {
        throw makeAdapterError("ENTITLEMENT_REQUIRED", "Entitlement token required.", { tool: toolName }, false, 401);
      }
      return null;
    }

    const decoded = decodeJwt(token);
    const alg = String(decoded.header?.alg ?? "");
    const nowSec = Math.floor(Date.now() / 1000);
    const skewSeconds = Number.isFinite(this.config.entitlementClockSkewSeconds)
      ? this.config.entitlementClockSkewSeconds
      : 30;

    if (!SUPPORTED_ALGORITHMS.has(alg)) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Unsupported entitlement token algorithm.", { alg }, false, 401);
    }

    const allowedAlgorithms = Array.isArray(this.config.entitlementAllowedAlgorithms) && this.config.entitlementAllowedAlgorithms.length > 0
      ? this.config.entitlementAllowedAlgorithms
      : ["RS256"];
    if (!allowedAlgorithms.includes(alg)) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement token algorithm not allowed.",
        { alg, allowed_algorithms: allowedAlgorithms },
        false,
        401
      );
    }

    let signatureValid = false;
    if (alg === "HS256") {
      if (!this.config.entitlementHmacSecret) {
        throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "HS256 entitlement secret not configured.", { alg }, false, 401);
      }
      signatureValid = verifyHs256(decoded, this.config.entitlementHmacSecret);
    } else if (alg === "RS256") {
      if (!this.config.entitlementPublicKeyPem) {
        throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "RS256 entitlement public key not configured.", { alg }, false, 401);
      }
      signatureValid = verifyRs256(decoded, this.config.entitlementPublicKeyPem);
    }

    if (!signatureValid) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token signature invalid.", { alg }, false, 401);
    }

    const payload = decoded.payload;
    if (typeof payload !== "object" || payload === null) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token payload invalid.", {}, false, 401);
    }
    if (this.config.entitlementIssuer && payload.iss !== this.config.entitlementIssuer) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token issuer invalid.", { expected: this.config.entitlementIssuer, received: payload.iss }, false, 401);
    }
    if (this.config.entitlementAudience) {
      const audiences = normalizeAudiences(payload.aud);
      if (!audiences.includes(this.config.entitlementAudience)) {
        throw makeAdapterError(
          "PAYMENT_VERIFICATION_FAILED",
          "Entitlement token audience invalid.",
          { expected: this.config.entitlementAudience, received: payload.aud },
          false,
          401
        );
      }
    }
    if (typeof payload.exp !== "number" || payload.exp <= nowSec - skewSeconds) {
      throw makeAdapterError("PAYMENT_SESSION_EXPIRED", "Entitlement token expired.", {}, false, 401);
    }
    if (typeof payload.nbf === "number" && payload.nbf > nowSec + skewSeconds) {
      throw makeAdapterError("ENTITLEMENT_REQUIRED", "Entitlement token is not active yet.", {}, false, 401);
    }
    if (typeof payload.iat === "number" && payload.iat > nowSec + skewSeconds) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token issued-at time invalid.", {}, false, 401);
    }
    if (typeof payload.exp === "number" && typeof payload.iat === "number" && payload.exp <= payload.iat) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token lifetime invalid.", {}, false, 401);
    }
    if (
      typeof payload.exp === "number" &&
      typeof payload.iat === "number" &&
      Number.isFinite(this.config.entitlementMaxTtlSeconds) &&
      payload.exp - payload.iat > this.config.entitlementMaxTtlSeconds
    ) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement token lifetime exceeds policy.",
        { max_ttl_seconds: this.config.entitlementMaxTtlSeconds },
        false,
        401
      );
    }

    const sessionId = payload.sid ?? payload.session_id ?? null;
    const tokenJti = payload.jti ?? null;
    const scopes = payload.scope ?? payload.scopes ?? [];

    if (!sessionId || !tokenJti) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token must include session_id and jti.", {}, false, 401);
    }
    if (!payload.sub || typeof payload.sub !== "string") {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Entitlement token must include subject.", {}, false, 401);
    }

    if (!scopeIncludes(scopes, toolName)) {
      throw makeAdapterError("ENTITLEMENT_REQUIRED", "Token scope does not allow this tool.", { tool: toolName, scopes }, false, 403);
    }

    if (callerContext?.external_agent_id && payload.sub !== callerContext.external_agent_id) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement token subject does not match caller identity.",
        { token_subject: payload.sub, caller: callerContext.external_agent_id },
        false,
        403
      );
    }
    if (paymentContext?.payer && payload.payer && paymentContext.payer !== payload.payer) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement token payer does not match payment payer.",
        { token_payer: payload.payer, payment_payer: paymentContext.payer },
        false,
        403
      );
    }

    if (tokenJti) {
      const existingByJti = await this.store.getEntitlementSessionByJti(tokenJti);
      if (existingByJti && existingByJti.expires_at && Date.parse(existingByJti.expires_at) < Date.now()) {
        throw makeAdapterError("PAYMENT_SESSION_EXPIRED", "Entitlement session expired.", { session_id: existingByJti.session_id }, false, 401);
      }
      if (existingByJti && existingByJti.session_id !== sessionId) {
        throw makeAdapterError(
          "PAYMENT_VERIFICATION_FAILED",
          "Entitlement token jti/session mismatch.",
          { token_jti: tokenJti, existing_session_id: existingByJti.session_id, session_id: sessionId },
          false,
          403
        );
      }
      if (existingByJti && existingByJti.token_subject && existingByJti.token_subject !== payload.sub) {
        throw makeAdapterError(
          "PAYMENT_VERIFICATION_FAILED",
          "Entitlement token subject mismatch for existing session.",
          { token_jti: tokenJti, existing_subject: existingByJti.token_subject, token_subject: payload.sub },
          false,
          403
        );
      }
    }

    const existingBySession = await this.store.getEntitlementSessionById(sessionId);
    if (existingBySession && existingBySession.token_jti && existingBySession.token_jti !== tokenJti) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement session reused with different token.",
        { session_id: sessionId, existing_token_jti: existingBySession.token_jti, token_jti: tokenJti },
        false,
        403
      );
    }
    if (existingBySession && existingBySession.token_subject && existingBySession.token_subject !== payload.sub) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement session subject mismatch.",
        { session_id: sessionId, existing_subject: existingBySession.token_subject, token_subject: payload.sub },
        false,
        403
      );
    }
    if (existingBySession && existingBySession.payer && payload.payer && existingBySession.payer !== payload.payer) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Entitlement session payer mismatch.",
        { session_id: sessionId, existing_payer: existingBySession.payer, token_payer: payload.payer },
        false,
        403
      );
    }

    const normalized = {
      session_id: sessionId,
      token_jti: tokenJti,
      issuer: payload.iss ?? null,
      audience: normalizeAudiences(payload.aud).join(" ") || null,
      token_subject: payload.sub ?? null,
      payer: payload.payer ?? payload.sub ?? null,
      scopes: normalizeScopeTokens(scopes),
      issued_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : null,
      expires_at: new Date(payload.exp * 1000).toISOString(),
      created_at: new Date().toISOString()
    };

    await this.store.upsertEntitlementSession(normalized);
    this.logger?.info?.({
      event: "entitlement_validated",
      adapter_trace_id: adapterTraceId,
      tool: toolName,
      session_id: normalized.session_id,
      token_jti: normalized.token_jti
    });

    return normalized;
  }
}
