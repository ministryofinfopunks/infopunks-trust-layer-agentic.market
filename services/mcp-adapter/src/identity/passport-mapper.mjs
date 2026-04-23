import { createHash } from "node:crypto";
import { FileIdentityMappingStore } from "./mapping-store.mjs";

function stableHash(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

function sanitize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function isSafeExternalId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    return false;
  }
  return !/[\u0000-\u001f\u007f]/.test(value);
}

export class PassportMapper {
  constructor({ mapPath, environment, store = null }) {
    this.environment = environment;
    this.store = store ?? new FileIdentityMappingStore({ filePath: mapPath });
  }

  normalizeIdentity(agent = {}) {
    const externalId = agent.agent_id ?? agent.agentId ?? agent.id ?? agent.did ?? agent.wallet ?? agent.address;
    if (!externalId || !isSafeExternalId(String(externalId))) {
      return null;
    }
    const canonical = sanitize(externalId) || `anon_${stableHash(externalId).slice(0, 12)}`;
    return {
      external_id: String(externalId),
      canonical,
      did: agent.did ?? `did:agentic:${canonical}`,
      wallet: agent.wallet ?? null,
      label: agent.label ?? agent.name ?? null
    };
  }

  async lookupInternalSubject(externalIdentity) {
    const mapping = await this.store.getByExternalId(externalIdentity);
    return mapping?.internal_subject_id ?? null;
  }

  async ensureInternalSubject(identity) {
    const existing = await this.lookupInternalSubject(identity.external_id);
    if (existing) {
      return existing;
    }

    const suffix = stableHash(identity.external_id).slice(0, 8);
    const subjectId = `agent_${identity.canonical}_${suffix}`.slice(0, 64);
    await this.store.upsert(identity.external_id, {
      external_source: "agentic.market",
      external_subject_id: identity.external_id,
      internal_subject_id: subjectId,
      external_handle: identity.label,
      did: identity.did,
      wallet: identity.wallet,
      created_at: new Date().toISOString(),
      environment: this.environment
    });
    return subjectId;
  }
}
