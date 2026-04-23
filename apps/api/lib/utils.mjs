import crypto from "node:crypto";

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(10).toString("hex").slice(0, 20).toUpperCase();
  return `${prefix}_${time}${random}`;
}

export function clamp(min, value, max) {
  return Math.max(min, Math.min(value, max));
}

export function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPayload(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

export function sendText(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

export function parseAuth(req) {
  const header = req.headers.authorization ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return match[1].trim() || null;
}

export function jsonLog(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
