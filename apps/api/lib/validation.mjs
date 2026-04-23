import { validationError } from "./errors.mjs";
import { generatedRequestSchemas } from "./generated-openapi.mjs";

function issue(path, message, code = "INVALID_FIELD") {
  return {
    path: path.length === 0 ? "$" : path.join("."),
    code,
    message
  };
}

function optional(schema) {
  return { kind: "optional", schema };
}

function string(options = {}) {
  return { kind: "string", ...options };
}

function number(options = {}) {
  return { kind: "number", ...options };
}

function boolean() {
  return { kind: "boolean" };
}

function enumeration(values) {
  return { kind: "enum", values };
}

function array(item, options = {}) {
  return { kind: "array", item, ...options };
}

function object(shape, options = {}) {
  return { kind: "object", shape, allowUnknown: options.allowUnknown ?? false };
}

function passthroughObject(shape = {}) {
  return object(shape, { allowUnknown: true });
}

function integer(options = {}) {
  return { kind: "integer", ...options };
}

function validateValue(schema, value, path = []) {
  if (schema.kind === "optional") {
    if (value === undefined) {
      return { ok: true, value: undefined, issues: [] };
    }
    return validateValue(schema.schema, value, path);
  }

  if (value === null) {
    if (schema.nullable) {
      return { ok: true, value: null, issues: [] };
    }
    return { ok: false, issues: [issue(path, "Expected non-null value.")] };
  }

  if (schema.kind === "string") {
    if (typeof value !== "string") {
      return { ok: false, issues: [issue(path, "Expected string.")] };
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return { ok: false, issues: [issue(path, `Expected string length >= ${schema.minLength}.`)] };
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return { ok: false, issues: [issue(path, `Expected string length <= ${schema.maxLength}.`)] };
    }
    return { ok: true, value, issues: [] };
  }

  if (schema.kind === "number") {
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      return { ok: false, issues: [issue(path, "Expected finite number.")] };
    }
    if (schema.min !== undefined && value < schema.min) {
      return { ok: false, issues: [issue(path, `Expected number >= ${schema.min}.`)] };
    }
    if (schema.max !== undefined && value > schema.max) {
      return { ok: false, issues: [issue(path, `Expected number <= ${schema.max}.`)] };
    }
    return { ok: true, value, issues: [] };
  }

  if (schema.kind === "integer") {
    if (!Number.isInteger(value)) {
      return { ok: false, issues: [issue(path, "Expected integer.")] };
    }
    return validateValue({ kind: "number", min: schema.min, max: schema.max }, value, path);
  }

  if (schema.kind === "boolean") {
    if (typeof value !== "boolean") {
      return { ok: false, issues: [issue(path, "Expected boolean.")] };
    }
    return { ok: true, value, issues: [] };
  }

  if (schema.kind === "enum") {
    if (!schema.values.includes(value)) {
      return { ok: false, issues: [issue(path, `Expected one of: ${schema.values.join(", ")}.`)] };
    }
    return { ok: true, value, issues: [] };
  }

  if (schema.kind === "array") {
    if (!Array.isArray(value)) {
      return { ok: false, issues: [issue(path, "Expected array.")] };
    }
    const issues = [];
    const normalized = [];
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(issue(path, `Expected array length >= ${schema.minLength}.`));
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push(issue(path, `Expected array length <= ${schema.maxLength}.`));
    }
    value.forEach((entry, index) => {
      const result = validateValue(schema.item, entry, [...path, String(index)]);
      if (!result.ok) {
        issues.push(...result.issues);
        return;
      }
      normalized.push(result.value);
    });
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: normalized, issues: [] };
  }

  if (schema.kind === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, issues: [issue(path, "Expected object.")] };
    }
    const issues = [];
    const normalized = {};
    for (const [key, childSchema] of Object.entries(schema.shape)) {
      const childValue = value[key];
      const result = validateValue(childSchema, childValue, [...path, key]);
      if (!result.ok) {
        issues.push(...result.issues);
        continue;
      }
      if (result.value !== undefined) {
        normalized[key] = result.value;
      }
    }
    if (!schema.allowUnknown) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.shape)) {
          issues.push(issue([...path, key], "Unknown field.", "UNKNOWN_FIELD"));
        }
      }
    } else {
      for (const [key, childValue] of Object.entries(value)) {
        if (!(key in schema.shape)) {
          normalized[key] = childValue;
        }
      }
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: normalized, issues: [] };
  }

  return { ok: false, issues: [issue(path, "Unsupported schema.")] };
}

export function validateOrThrow(schema, value) {
  const result = validateValue(schema, value, []);
  if (!result.ok) {
    throw validationError(result.issues);
  }
  return result.value;
}

const publicKeySchema = object({
  kid: string({ minLength: 1 }),
  alg: string({ minLength: 1 }),
  public_key: string({ minLength: 1 })
});

const capabilitySchema = object({
  name: string({ minLength: 1 }),
  version: string({ minLength: 1 }),
  verified: boolean()
});

const issuerSchema = object({
  issuer_id: string({ minLength: 1 }),
  signature: string({ minLength: 1 })
});

const reputationScopeDefaultsSchema = object({
  domains: array(string({ minLength: 1 }), { minLength: 0, maxLength: 25 }),
  risk_tolerance: enumeration(["low", "medium", "high"])
});

const validatorSchema = object({
  validator_id: string({ minLength: 1 }),
  verdict: string({ minLength: 1 }),
  weight: number({ min: 0, max: 1 }),
  reason_codes: array(string({ minLength: 1 }), { minLength: 0, maxLength: 20 })
});

const contextSchema = passthroughObject({
  task_type: optional(string({ minLength: 1 })),
  domain: optional(string({ minLength: 1 })),
  risk_level: optional(enumeration(["low", "medium", "high"])),
  requires_validation: optional(boolean())
});

const outcomeSchema = passthroughObject({
  status: optional(string({ minLength: 1 })),
  latency_ms: optional(number({ min: 0 })),
  cost_usd: optional(number({ min: 0 })),
  quality_score: optional(number({ min: 0, max: 1 })),
  confidence_score: optional(number({ min: 0, max: 1 }))
});

const provenanceSchema = passthroughObject({
  source_system: optional(string({ minLength: 1 })),
  trace_id: optional(string({ minLength: 1 })),
  span_id: optional(string({ minLength: 1 }))
});

export const schemas = {
  budgetQuote: generatedRequestSchemas.BudgetQuoteRequest,
  passportCreate: generatedRequestSchemas.PassportCreateRequest,
  passportRotateKey: generatedRequestSchemas.PassportRotateKeyRequest,
  evidenceCreate: generatedRequestSchemas.EvidenceCreateRequest,
  webhookCreate: generatedRequestSchemas.WebhookCreateRequest,
  portabilityExport: generatedRequestSchemas.PortabilityExportRequest,
  portabilityImport: generatedRequestSchemas.PortabilityImportRequest,
  disputeEvaluate: generatedRequestSchemas.DisputeEvaluateRequest,
  trustResolve: generatedRequestSchemas.TrustResolveRequest,
  routingSelectValidator: generatedRequestSchemas.RoutingSelectValidatorRequest,
  routingSelectExecutor: generatedRequestSchemas.RoutingSelectExecutorRequest,
  economicEscrowQuote: generatedRequestSchemas.EscrowQuoteRequest,
  economicRiskPrice: generatedRequestSchemas.RiskPriceRequest,
  economicAttestationBundle: generatedRequestSchemas.AttestationBundleRequest,
  simRun: generatedRequestSchemas.SimRunRequest
};
