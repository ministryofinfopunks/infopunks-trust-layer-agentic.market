import {
  assertProofSafety,
  buildPayment,
  executePaidTrustCall,
  fetchWarRoomEvents,
  printExecutionBanner,
  resolveProofConfig,
  writeProofArtifacts
} from "./lib.mjs";

function uniqueSubject(base) {
  return `${base}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

const config = resolveProofConfig();
assertProofSafety(config);
printExecutionBanner(config);

const calls = [];
const trustedSubject = process.env.PROOF_TRUSTED_SUBJECT_ID ?? "agent_001";
const lowTrustSubject = process.env.PROOF_LOW_TRUST_SUBJECT_ID ?? "agent_low_001";
const unknownSubject = process.env.PROOF_UNKNOWN_SUBJECT_ID ?? uniqueSubject("agent_bootstrap");
const degradedSubject = process.env.PROOF_DEGRADED_SUBJECT_ID ?? null;
const payer = process.env.PROOF_PAYER ?? null;

// A. trusted executor call
calls.push(await executePaidTrustCall({
  config,
  subjectId: trustedSubject,
  payment: buildPayment({
    subjectId: trustedSubject,
    payerOverride: payer
  }),
  label: "A_trusted_executor_call"
}));

// B. low-trust executor call
calls.push(await executePaidTrustCall({
  config,
  subjectId: lowTrustSubject,
  payment: buildPayment({
    subjectId: lowTrustSubject,
    payerOverride: payer
  }),
  label: "B_low_trust_executor_call"
}));

// C. unknown subject auto-bootstrap
calls.push(await executePaidTrustCall({
  config,
  subjectId: unknownSubject,
  payment: buildPayment({
    subjectId: unknownSubject,
    payerOverride: payer
  }),
  label: "C_unknown_subject_auto_bootstrap"
}));

// D. replay attempt using same nonce/payment payload (same nonce, new idempotency key)
const replayNonce = `nonce_replay_${Date.now()}`;
const replayFirst = await executePaidTrustCall({
  config,
  subjectId: trustedSubject,
  payment: buildPayment({
    subjectId: trustedSubject,
    payerOverride: payer,
    nonceOverride: replayNonce,
    idempotencyOverride: `idem_replay_first_${Date.now()}`
  }),
  label: "D1_replay_control_first"
});
calls.push(replayFirst);
calls.push(await executePaidTrustCall({
  config,
  subjectId: trustedSubject,
  payment: buildPayment({
    subjectId: trustedSubject,
    payerOverride: payer,
    nonceOverride: replayNonce,
    idempotencyOverride: `idem_replay_second_${Date.now()}`
  }),
  label: "D2_replay_attempt_second"
}));

// E. degraded fallback simulation if supported
if (degradedSubject) {
  calls.push(await executePaidTrustCall({
    config,
    subjectId: degradedSubject,
    payment: buildPayment({
      subjectId: degradedSubject,
      payerOverride: payer
    }),
    label: "E_degraded_fallback_attempt"
  }));
} else {
  calls.push({
    label: "E_degraded_fallback_attempt",
    timestamp: new Date().toISOString(),
    http_status: 0,
    payer: payer,
    subject_id: "not_run",
    trust_score: null,
    trust_tier: null,
    mode: null,
    confidence: null,
    status: "skipped",
    receipt_id: null,
    amount: null,
    war_room_event_id: null,
    error_code: null,
    reason: "Set PROOF_DEGRADED_SUBJECT_ID to attempt explicit degraded fallback simulation.",
    response_payload: null
  });
}

const warRoomEvents = await fetchWarRoomEvents(config).catch(() => []);
const artifactFiles = writeProofArtifacts({
  config,
  calls,
  warRoomEvents
});

const rollup = {
  total_calls: calls.length,
  successful_calls: calls.filter((entry) => entry.http_status >= 200 && entry.http_status < 300).length,
  failed_or_rejected_calls: calls.filter((entry) => entry.http_status >= 400 || entry.status === "rejected").length,
  degraded_calls: calls.filter((entry) => String(entry.mode ?? "").toLowerCase() === "degraded").length,
  receipts: calls.map((entry) => entry.receipt_id).filter(Boolean),
  subjects_checked: [...new Set(calls.map((entry) => entry.subject_id).filter(Boolean))],
  artifacts: artifactFiles
};

process.stdout.write(`${JSON.stringify(rollup, null, 2)}\n`);

