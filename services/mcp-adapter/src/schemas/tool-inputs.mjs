import { makeAdapterError } from "./error-schema.mjs";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasControlChars(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function requireObject(name, value) {
  if (!isObject(value)) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be an object.`, { field: name }, false, 400);
  }
}

function requireString(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw makeAdapterError("INVALID_INPUT", `${name} must be a non-empty string.`, { field: name }, false, 400);
  }
  if (value.length > 256 || hasControlChars(value)) {
    throw makeAdapterError("INVALID_INPUT", `${name} is invalid.`, { field: name }, false, 400);
  }
}

function requireArray(name, value, minLength = 1) {
  if (!Array.isArray(value) || value.length < minLength) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be an array with at least ${minLength} item(s).`, { field: name }, false, 400);
  }
}

function requireBoolean(name, value) {
  if (typeof value !== "boolean") {
    throw makeAdapterError("INVALID_INPUT", `${name} must be a boolean.`, { field: name }, false, 400);
  }
}

function requireFiniteNumber(name, value, { min = null } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be a finite number.`, { field: name }, false, 400);
  }
  if (min !== null && value < min) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be greater than or equal to ${min}.`, { field: name }, false, 400);
  }
}

function requireInteger(name, value, { min = null } = {}) {
  if (!Number.isInteger(value)) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be an integer.`, { field: name }, false, 400);
  }
  if (min !== null && value < min) {
    throw makeAdapterError("INVALID_INPUT", `${name} must be greater than or equal to ${min}.`, { field: name }, false, 400);
  }
}

function requireStringArray(name, value, minLength = 1) {
  requireArray(name, value, minLength);
  for (let i = 0; i < value.length; i += 1) {
    requireString(`${name}[${i}]`, value[i]);
  }
}

function requireMaxArrayLength(name, value, maxLength) {
  if (Array.isArray(value) && value.length > maxLength) {
    throw makeAdapterError(
      "INVALID_INPUT",
      `${name} may include at most ${maxLength} item(s).`,
      { field: name, max: maxLength },
      false,
      400
    );
  }
}

function requireEnum(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw makeAdapterError(
      "INVALID_INPUT",
      `${name} must be one of: ${allowed.join(", ")}.`,
      { field: name, allowed },
      false,
      400
    );
  }
}

function rejectUnknownFields(operation, args) {
  const allowedFields = {
    get_passport: ["agent", "subject_id", "create_if_missing"],
    resolve_trust: [
      "agent",
      "subject_id",
      "context",
      "policy_id",
      "policy_version",
      "include",
      "response_mode",
      "candidate_validators",
      "payment",
      "spend_limit_units"
    ],
    select_validators: ["agent", "subject_id", "task_id", "candidates", "context", "minimum_count", "quorum_policy", "payment", "spend_limit_units"],
    select_executor: ["agent", "subject_id", "task_id", "candidates", "context", "minimum_count", "maximum_cost_usd", "allow_autonomy_downgrade", "payment", "spend_limit_units"],
    evaluate_dispute: ["agent", "subject_id", "task_id", "evidence_ids", "context", "reason_code", "severity", "preferred_resolution", "disputed_by", "notes", "payment", "spend_limit_units"],
    get_trace_replay: ["trace_id", "payment", "spend_limit_units"],
    get_prompt_pack: ["name"],
    export_portability_bundle: ["agent", "subject_id", "include_evidence", "evidence_limit", "include_trace_ids", "target_network", "payment", "spend_limit_units"],
    import_portability_bundle: ["bundle", "import_mode", "payment", "spend_limit_units"],
    quote_risk: ["agent", "subject_id", "context", "task_id", "exposure_usd", "payment", "spend_limit_units"]
  };
  const allowed = allowedFields[operation];
  if (!allowed) {
    return;
  }
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      throw makeAdapterError("INVALID_INPUT", `Unexpected field "${key}" for ${operation}.`, { field: key, operation }, false, 400);
    }
  }
}

function validateCommon(args) {
  if (!isObject(args)) {
    throw makeAdapterError("INVALID_INPUT", "Tool arguments must be an object.", {}, false, 400);
  }
  if (args.agent !== undefined && !isObject(args.agent)) {
    throw makeAdapterError("INVALID_INPUT", "agent must be an object.", { field: "agent" }, false, 400);
  }
  if (args.payment !== undefined && !isObject(args.payment)) {
    throw makeAdapterError("INVALID_INPUT", "payment must be an object.", { field: "payment" }, false, 400);
  }
  if (args.payment?.payer !== undefined) {
    requireString("payment.payer", args.payment.payer);
  }
  if (args.agent?.agent_id !== undefined) {
    requireString("agent.agent_id", args.agent.agent_id);
  }
  if (args.agent?.id !== undefined) {
    requireString("agent.id", args.agent.id);
  }
  if (args.agent?.did !== undefined) {
    requireString("agent.did", args.agent.did);
  }
  if (args.agent?.wallet !== undefined) {
    requireString("agent.wallet", args.agent.wallet);
  }
  if (args.spend_limit_units !== undefined) {
    requireFiniteNumber("spend_limit_units", args.spend_limit_units, { min: 0 });
  }
}

function validateResolveTrust(args) {
  validateCommon(args);
  requireString("subject_id", args.subject_id);
  requireObject("context", args.context);
  if (args.policy_id !== undefined) {
    requireString("policy_id", args.policy_id);
  }
  if (args.policy_version !== undefined) {
    requireString("policy_version", args.policy_version);
  }
  if (args.include !== undefined) {
    requireStringArray("include", args.include, 1);
    requireMaxArrayLength("include", args.include, 20);
  }
  if (args.candidate_validators !== undefined) {
    requireStringArray("candidate_validators", args.candidate_validators, 1);
    requireMaxArrayLength("candidate_validators", args.candidate_validators, 100);
  }
  if (args.response_mode !== undefined) {
    requireString("response_mode", args.response_mode);
    requireEnum("response_mode", args.response_mode, ["minimal", "standard", "explain", "audit"]);
  }
}

function validateSelectValidators(args) {
  validateCommon(args);
  requireString("subject_id", args.subject_id);
  requireStringArray("candidates", args.candidates, 1);
  requireMaxArrayLength("candidates", args.candidates, 200);
  requireObject("context", args.context);
  if (args.task_id !== undefined) {
    requireString("task_id", args.task_id);
  }
  if (args.minimum_count !== undefined) {
    requireInteger("minimum_count", args.minimum_count, { min: 1 });
  }
  if (args.quorum_policy !== undefined) {
    requireObject("quorum_policy", args.quorum_policy);
  }
}

function validateSelectExecutor(args) {
  validateCommon(args);
  requireString("subject_id", args.subject_id);
  requireStringArray("candidates", args.candidates, 1);
  requireMaxArrayLength("candidates", args.candidates, 200);
  requireObject("context", args.context);
  if (args.task_id !== undefined) {
    requireString("task_id", args.task_id);
  }
  if (args.minimum_count !== undefined) {
    requireInteger("minimum_count", args.minimum_count, { min: 1 });
  }
  if (args.maximum_cost_usd !== undefined) {
    requireFiniteNumber("maximum_cost_usd", args.maximum_cost_usd, { min: 0 });
  }
  if (args.allow_autonomy_downgrade !== undefined) {
    requireBoolean("allow_autonomy_downgrade", args.allow_autonomy_downgrade);
  }
}

function validateEvaluateDispute(args) {
  validateCommon(args);
  requireString("subject_id", args.subject_id);
  requireStringArray("evidence_ids", args.evidence_ids, 1);
  requireMaxArrayLength("evidence_ids", args.evidence_ids, 256);
  requireObject("context", args.context);
  requireString("reason_code", args.reason_code);
  requireString("severity", args.severity);
  requireEnum("severity", args.severity, ["low", "medium", "high", "critical"]);
  if (args.task_id !== undefined) {
    requireString("task_id", args.task_id);
  }
  if (args.preferred_resolution !== undefined) {
    requireString("preferred_resolution", args.preferred_resolution);
  }
  if (args.disputed_by !== undefined) {
    requireString("disputed_by", args.disputed_by);
  }
  if (args.notes !== undefined) {
    requireString("notes", args.notes);
  }
}

function validateGetTraceReplay(args) {
  validateCommon(args);
  requireString("trace_id", args.trace_id);
}

function validateGetPromptPack(args) {
  validateCommon(args);
  requireString("name", args.name);
}

function validateExportPortability(args) {
  validateCommon(args);
  if (!args.agent && !args.subject_id) {
    throw makeAdapterError(
      "INVALID_INPUT",
      "Either agent or subject_id is required for export_portability_bundle.",
      { field: "agent|subject_id" },
      false,
      400
    );
  }
  if (args.evidence_limit !== undefined) {
    requireInteger("evidence_limit", args.evidence_limit, { min: 1 });
  }
  if (args.include_evidence !== undefined) {
    requireBoolean("include_evidence", args.include_evidence);
  }
  if (args.include_trace_ids !== undefined) {
    requireBoolean("include_trace_ids", args.include_trace_ids);
  }
}

function validateImportPortability(args) {
  validateCommon(args);
  requireObject("bundle", args.bundle);
  if (args.import_mode !== undefined) {
    requireString("import_mode", args.import_mode);
    requireEnum("import_mode", args.import_mode, ["merge", "replace"]);
  }
}

function validateQuoteRisk(args) {
  validateCommon(args);
  requireString("subject_id", args.subject_id);
  requireObject("context", args.context);
  requireFiniteNumber("exposure_usd", args.exposure_usd, { min: 0 });
  if (args.task_id !== undefined) {
    requireString("task_id", args.task_id);
  }
}

function validateGetPassport(args) {
  validateCommon(args);
  if (!args.agent && !args.subject_id) {
    throw makeAdapterError(
      "INVALID_INPUT",
      "Either agent or subject_id is required for get_passport.",
      { field: "agent|subject_id" },
      false,
      400
    );
  }
  if (args.subject_id !== undefined) {
    requireString("subject_id", args.subject_id);
  }
  if (args.create_if_missing !== undefined) {
    requireBoolean("create_if_missing", args.create_if_missing);
  }
}

const validators = {
  get_passport: validateGetPassport,
  resolve_trust: validateResolveTrust,
  select_validators: validateSelectValidators,
  select_executor: validateSelectExecutor,
  evaluate_dispute: validateEvaluateDispute,
  get_trace_replay: validateGetTraceReplay,
  get_prompt_pack: validateGetPromptPack,
  export_portability_bundle: validateExportPortability,
  import_portability_bundle: validateImportPortability,
  quote_risk: validateQuoteRisk
};

export function validateToolInput(operation, args) {
  const validator = validators[operation];
  if (!validator) {
    throw makeAdapterError("INVALID_INPUT", `No validator configured for operation ${operation}.`, { operation }, false, 500);
  }
  const normalizedArgs = args ?? {};
  rejectUnknownFields(operation, normalizedArgs);
  validator(normalizedArgs);
  return normalizedArgs;
}
