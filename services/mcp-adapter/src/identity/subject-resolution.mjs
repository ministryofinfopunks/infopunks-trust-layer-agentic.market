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
  constructor({ apiClient, mapper, config, store = null }) {
    this.apiClient = apiClient;
    this.mapper = mapper;
    this.config = config;
    this.store = store;
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

  async resolveTarget(subjectId, { createIfMissing = false, autoBootstrapIfMissing = false } = {}, adapterTraceId = null) {
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

    const shouldAutoBootstrap = Boolean(
      autoBootstrapIfMissing
      && this.config.autoBootstrapUnknownSubjects !== false
    );
    if (!shouldAutoBootstrap && (!createIfMissing || this.config.targetResolutionPolicy === "lookup-only")) {
      throw makeAdapterError("UNKNOWN_SUBJECT", "Target subject is not registered.", { subject_id: subjectId }, false, 404);
    }

    if (shouldAutoBootstrap) {
      const bootstrapScore = Number.isFinite(this.config.autoBootstrapTrustScore)
        ? this.config.autoBootstrapTrustScore
        : 20;
      const bootstrapTier = String(this.config.autoBootstrapTrustTier ?? "unverified");
      const ownerId = adapterTraceId ?? `bootstrap_${Date.now()}`;
      const lockName = `auto-bootstrap:${subjectId}`;
      const hasLockApi = this.store
        && typeof this.store.acquireLock === "function"
        && typeof this.store.releaseLock === "function";
      let lockAcquired = false;
      try {
        if (hasLockApi) {
          lockAcquired = await this.store.acquireLock(lockName, ownerId, 10);
        }

        if (hasLockApi && !lockAcquired) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          const existing = await this.apiClient.getPassport(subjectId, adapterTraceId).catch(() => null);
          if (existing) {
            return {
              subject_id: subjectId,
              passport: existing,
              created: false,
              auto_bootstrapped: false
            };
          }
        }

        const existingBeforeCreate = await this.apiClient.getPassport(subjectId, adapterTraceId).catch(() => null);
        if (existingBeforeCreate) {
          return {
            subject_id: subjectId,
            passport: existingBeforeCreate,
            created: false,
            auto_bootstrapped: false
          };
        }

        const createInput = {
          subject_id: subjectId,
          subject_type: "agent",
          did: `did:agentic:${subjectId}`,
          public_keys: [{ kid: "agentic_primary", alg: "EdDSA", public_key: `agentic:${subjectId}` }],
          capabilities: [{ name: "trust_resolution", version: "1.0", verified: false }],
          metadata: {
            source: "agentic.market",
            provisional: true,
            bootstrap: {
              trust_score: bootstrapScore,
              trust_tier: bootstrapTier,
              provisional: true,
              reason: "AUTO_BOOTSTRAPPED_SUBJECT"
            }
          }
        };
        try {
          await this.apiClient.createPassport(createInput, `auto-bootstrap-${subjectId}`);
        } catch (error) {
          if (error?.status !== 409) {
            throw error;
          }
        }
        const passport = await this.apiClient.getPassport(subjectId, adapterTraceId);
        return {
          subject_id: subjectId,
          passport,
          created: true,
          auto_bootstrapped: true,
          bootstrap: {
            subject_id: subjectId,
            trust_score: bootstrapScore,
            trust_tier: bootstrapTier,
            provisional: true,
            reason: "AUTO_BOOTSTRAPPED_SUBJECT"
          }
        };
      } finally {
        if (hasLockApi && lockAcquired) {
          await this.store.releaseLock(lockName, ownerId);
        }
      }
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
