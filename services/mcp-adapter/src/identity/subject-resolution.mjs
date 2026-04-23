import { makeAdapterError } from "../schemas/error-schema.mjs";

function buildPassportCreateInput(subjectId, identity, environment) {
  return {
    subject_id: subjectId,
    subject_type: "agent",
    did: identity.did,
    public_keys: [
      {
        kid: "agentic_primary",
        alg: "EdDSA",
        public_key: `agentic:${subjectId}`
      }
    ],
    capabilities: [
      { name: "trust_resolution", version: "1.0", verified: true },
      { name: "routing", version: "1.0", verified: true }
    ],
    metadata: {
      source: "agentic.market",
      framework: "mcp",
      environment,
      external_subject_id: identity.external_id,
      wallet: identity.wallet,
      label: identity.label
    }
  };
}

export class SubjectResolutionService {
  constructor({ apiClient, mapper, config }) {
    this.apiClient = apiClient;
    this.mapper = mapper;
    this.config = config;
  }

  async resolveCaller(agent, policy = this.config.callerResolutionPolicy, adapterTraceId = null) {
    const identity = this.mapper.normalizeIdentity(agent);
    if (!identity) {
      throw makeAdapterError("PASSPORT_REQUIRED", "Caller identity is required.", {}, false, 400);
    }
    const subjectId = await this.mapper.ensureInternalSubject(identity);

    try {
      const passport = await this.apiClient.getPassport(subjectId, adapterTraceId);
      return { subject_id: subjectId, passport, identity, created: false };
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }

    if (policy === "lookup-only") {
      throw makeAdapterError("UNKNOWN_SUBJECT", "No Passport exists for caller identity.", { subject_id: subjectId }, false, 404);
    }

    const createInput = buildPassportCreateInput(subjectId, identity, this.config.environment);
    await this.apiClient.createPassport(createInput, `agentic-passport-${subjectId}`);
    const passport = await this.apiClient.getPassport(subjectId, adapterTraceId);
    return { subject_id: subjectId, passport, identity, created: true };
  }

  async resolveTarget(subjectId, { createIfMissing = false } = {}, adapterTraceId = null) {
    if (!subjectId) {
      return null;
    }

    try {
      const passport = await this.apiClient.getPassport(subjectId, adapterTraceId);
      return { subject_id: subjectId, passport, created: false };
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }

    if (!createIfMissing || this.config.targetResolutionPolicy === "lookup-only") {
      throw makeAdapterError("UNKNOWN_SUBJECT", "Target subject is not registered.", { subject_id: subjectId }, false, 404);
    }

    const createInput = {
      subject_id: subjectId,
      subject_type: "agent",
      did: `did:agentic:${subjectId}`,
      public_keys: [{ kid: "agentic_primary", alg: "EdDSA", public_key: `agentic:${subjectId}` }],
      capabilities: [{ name: "trust_resolution", version: "1.0", verified: false }],
      metadata: { source: "agentic.market", provisional: true }
    };
    await this.apiClient.createPassport(createInput, `target-passport-${subjectId}`);
    const passport = await this.apiClient.getPassport(subjectId, adapterTraceId);
    return { subject_id: subjectId, passport, created: true };
  }
}
