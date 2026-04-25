#!/usr/bin/env node

function usage() {
  console.log(`Usage: node scripts/bootstrap/register-subject.mjs --subject-id <id> [--base-url <url>] [--api-key <token>] [--subject-type <agent|validator|operator_service|tool_adapter>]

Environment fallbacks:
  INFOPUNKS_CORE_BASE_URL or CORE_API_BASE_URL
  INFOPUNKS_API_KEY or CORE_API_KEY

Example:
  node scripts/bootstrap/register-subject.mjs \\
    --subject-id agent_001 \\
    --base-url https://infopunks-core-api.onrender.com \\
    --api-key <core_api_key>`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    usage();
    return;
  }

  const subjectId = String(args["subject-id"] ?? "").trim();
  if (!subjectId) {
    console.error("Missing --subject-id");
    usage();
    process.exit(1);
  }

  const baseUrl = String(
    args["base-url"]
      ?? process.env.INFOPUNKS_CORE_BASE_URL
      ?? process.env.CORE_API_BASE_URL
      ?? ""
  ).trim().replace(/\/$/, "");
  if (!baseUrl) {
    console.error("Missing --base-url (or INFOPUNKS_CORE_BASE_URL / CORE_API_BASE_URL)");
    process.exit(1);
  }

  const apiKey = String(
    args["api-key"]
      ?? process.env.INFOPUNKS_API_KEY
      ?? process.env.CORE_API_KEY
      ?? ""
  ).trim();
  if (!apiKey) {
    console.error("Missing --api-key (or INFOPUNKS_API_KEY / CORE_API_KEY)");
    process.exit(1);
  }

  const subjectType = String(args["subject-type"] ?? "agent").trim();
  const payload = {
    subject_id: subjectId,
    subject_type: subjectType,
    did: `did:agentic:${subjectId}`,
    public_keys: [{ kid: "agentic_primary", alg: "EdDSA", public_key: `agentic:${subjectId}` }],
    capabilities: [{ name: "trust_resolution", version: "1.0", verified: false }],
    metadata: { source: "bootstrap-script", provisional: true }
  };

  const idempotencyKey = `bootstrap-${subjectId}-${Date.now()}`;
  const createResponse = await fetch(`${baseUrl}/v1/passports`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const createText = await createResponse.text();

  if (![200, 201, 409].includes(createResponse.status)) {
    console.error("Failed to create subject passport.");
    console.error(`Status: ${createResponse.status}`);
    console.error(createText);
    process.exit(1);
  }

  const verifyResponse = await fetch(`${baseUrl}/v1/passports/${encodeURIComponent(subjectId)}`, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`
    }
  });
  const verifyText = await verifyResponse.text();

  if (!verifyResponse.ok) {
    console.error("Passport create call returned success-ish, but verification fetch failed.");
    console.error(`Status: ${verifyResponse.status}`);
    console.error(verifyText);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    subject_id: subjectId,
    create_status: createResponse.status,
    verify_status: verifyResponse.status,
    message: "Subject passport is registered and ready for trust-score calls."
  }, null, 2));
}

main().catch((error) => {
  console.error("Bootstrap failed:", error?.message ?? error);
  process.exit(1);
});
