const KNOWN_EXTENSION_STATUSES = new Set(["processing", "accepted", "rejected", "error"]);
const RAW_HEADER_MAX_LENGTH = 4096;

function sanitizeExtensionText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeExtensionStatus(value) {
  const normalized = sanitizeExtensionText(value)?.toLowerCase() ?? null;
  return normalized && KNOWN_EXTENSION_STATUSES.has(normalized) ? normalized : null;
}

function splitStructuredHeader(value) {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "{" || char === "[") {
      depth += 1;
      current += char;
      continue;
    }
    if (char === "}" || char === "]") {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (char === "," && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }
    current += char;
  }
  const trimmed = current.trim();
  if (trimmed) {
    parts.push(trimmed);
  }
  return parts;
}

function unquoteStructuredValue(value) {
  const trimmed = sanitizeExtensionText(value);
  if (!trimmed) {
    return null;
  }
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || null;
  }
  return trimmed;
}

function normalizeExtensionEntry(entry, fallbackName = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const extensionName = sanitizeExtensionText(
    entry.extension_name
    ?? entry.extension
    ?? entry.name
    ?? entry.id
    ?? fallbackName
  );
  const status = normalizeExtensionStatus(entry.status ?? entry.state ?? entry.result ?? entry.outcome);
  const reason = sanitizeExtensionText(entry.reason);
  const message = sanitizeExtensionText(entry.message ?? entry.error ?? entry.detail);
  if (!extensionName && !status && !reason && !message) {
    return null;
  }
  return {
    ...(extensionName ? { extension_name: extensionName } : {}),
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(message ? { message } : {})
  };
}

function parseStructuredExtensionEntries(value) {
  return splitStructuredHeader(value)
    .map((segment) => {
      const tokens = segment.split(/[;|]/).map((token) => token.trim()).filter(Boolean);
      const fields = {};
      const bareTokens = [];
      for (const token of tokens) {
        const match = token.match(/^([^=:]+)\s*[:=]\s*(.+)$/);
        if (!match) {
          bareTokens.push(unquoteStructuredValue(token));
          continue;
        }
        const key = match[1].trim().toLowerCase().replace(/[\s-]+/g, "_");
        fields[key] = unquoteStructuredValue(match[2]);
      }
      const bareStatus = bareTokens.find((token) => normalizeExtensionStatus(token));
      const bareName = bareTokens.find((token) => token && !normalizeExtensionStatus(token));
      return normalizeExtensionEntry({
        extension_name: fields.extension_name ?? fields.extension ?? fields.name ?? fields.id ?? bareName,
        status: fields.status ?? fields.state ?? fields.result ?? fields.outcome ?? bareStatus,
        reason: fields.reason,
        message: fields.message ?? fields.error ?? fields.detail
      });
    })
    .filter(Boolean);
}

function normalizeExtensionEntries(value, fallbackName = null) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeExtensionEntries(entry, fallbackName));
  }
  if (typeof value === "string") {
    return parseStructuredExtensionEntries(value);
  }
  if (typeof value !== "object") {
    return [];
  }

  const nested = value.extensions
    ?? value.extensionResponses
    ?? value.extension_responses
    ?? value.responses
    ?? value.results
    ?? value.items
    ?? value.data;
  if (nested) {
    const normalizedNested = normalizeExtensionEntries(nested, fallbackName);
    if (normalizedNested.length) {
      return normalizedNested;
    }
  }

  const directEntry = normalizeExtensionEntry(value, fallbackName);
  if (
    directEntry
    && (
      Object.hasOwn(value, "status")
      || Object.hasOwn(value, "state")
      || Object.hasOwn(value, "result")
      || Object.hasOwn(value, "outcome")
      || Object.hasOwn(value, "reason")
      || Object.hasOwn(value, "message")
      || Object.hasOwn(value, "error")
      || Object.hasOwn(value, "detail")
    )
  ) {
    return [directEntry];
  }

  const nestedEntries = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue && typeof nestedValue === "object") {
      nestedEntries.push(...normalizeExtensionEntries(nestedValue, key));
    }
  }
  if (nestedEntries.length) {
    return nestedEntries;
  }

  return directEntry ? [directEntry] : [];
}

function redactSecrets(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+\b/gi, "Bearer [REDACTED]")
    .replace(/\b(authorization|api[-_]?key|token|signature|private[-_ ]?key)\b\s*[:=]\s*[^;,]+/gi, "$1=[REDACTED]")
    .replace(/0x[a-fA-F0-9]{130}/g, "[REDACTED_HEX_SIGNATURE]");
}

function sanitizeRawHeader(value) {
  const normalized = sanitizeExtensionText(value);
  if (!normalized) {
    return null;
  }
  const redacted = redactSecrets(normalized);
  return redacted.length > RAW_HEADER_MAX_LENGTH ? `${redacted.slice(0, RAW_HEADER_MAX_LENGTH)}...[truncated]` : redacted;
}

export function parseExtensionResponsesHeader(headerValue) {
  const sanitized = sanitizeExtensionText(headerValue);
  if (!sanitized) {
    return [];
  }
  if (sanitized.startsWith("{") || sanitized.startsWith("[")) {
    try {
      return normalizeExtensionEntries(JSON.parse(sanitized));
    } catch {
      return parseStructuredExtensionEntries(sanitized);
    }
  }
  return parseStructuredExtensionEntries(sanitized);
}

export function buildBazaarExtensionDiagnostics(headerValue, phase = null) {
  const raw = sanitizeRawHeader(headerValue);
  const entries = parseExtensionResponsesHeader(headerValue);
  const bazaarEntry = entries.find((entry) => String(entry?.extension_name ?? "").toLowerCase() === "bazaar") ?? null;

  if (!raw) {
    return {
      bazaar_extension_status: "missing",
      bazaar_extension_reason: null,
      bazaar_extension_raw: null,
      bazaar_extension_phase: phase ?? null
    };
  }

  const status = bazaarEntry?.status ?? "present_without_bazaar";
  const reason = bazaarEntry?.reason ?? bazaarEntry?.message ?? null;
  const normalizedReason = status === "rejected"
    ? (reason ?? "Bazaar extension rejected by facilitator without an explicit reason.")
    : reason;

  return {
    bazaar_extension_status: status,
    bazaar_extension_reason: normalizedReason,
    bazaar_extension_raw: raw,
    bazaar_extension_phase: phase ?? null
  };
}

export function mergeBazaarExtensionDiagnostics(primary = null, secondary = null) {
  const first = primary ?? {};
  const second = secondary ?? {};
  const primaryStatus = sanitizeExtensionText(first.bazaar_extension_status) ?? "missing";
  const secondaryStatus = sanitizeExtensionText(second.bazaar_extension_status) ?? "missing";
  const status = secondaryStatus !== "missing" ? secondaryStatus : primaryStatus;
  const reason = status === secondaryStatus
    ? (second.bazaar_extension_reason ?? first.bazaar_extension_reason ?? null)
    : (first.bazaar_extension_reason ?? second.bazaar_extension_reason ?? null);
  const raw = status === secondaryStatus
    ? (second.bazaar_extension_raw ?? first.bazaar_extension_raw ?? null)
    : (first.bazaar_extension_raw ?? second.bazaar_extension_raw ?? null);

  return {
    bazaar_extension_status: status,
    bazaar_extension_reason: reason,
    bazaar_extension_raw: raw,
    bazaar_verify_extension_status: first.bazaar_extension_status ?? "missing",
    bazaar_verify_extension_reason: first.bazaar_extension_reason ?? null,
    bazaar_verify_extension_raw: first.bazaar_extension_raw ?? null,
    bazaar_settle_extension_status: second.bazaar_extension_status ?? "missing",
    bazaar_settle_extension_reason: second.bazaar_extension_reason ?? null,
    bazaar_settle_extension_raw: second.bazaar_extension_raw ?? null
  };
}
