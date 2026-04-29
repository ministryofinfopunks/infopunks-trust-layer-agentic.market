import {
  assertProofSafety,
  buildPayment,
  executePaidTrustCall,
  fetchWarRoomEvents,
  printExecutionBanner,
  printSingleCallProof,
  resolveProofConfig,
  writeProofArtifacts
} from "./lib.mjs";

const config = resolveProofConfig();
assertProofSafety(config);
printExecutionBanner(config);

const subjectId = process.env.PROOF_SUBJECT_ID ?? "agent_001";
const payment = buildPayment({
  subjectId,
  payerOverride: process.env.PROOF_PAYER ?? null
});

const call = await executePaidTrustCall({
  config,
  subjectId,
  payment,
  label: "single_paid_call"
});
const warRoomEvents = await fetchWarRoomEvents(config).catch(() => []);
const artifactFiles = writeProofArtifacts({
  config,
  calls: [call],
  warRoomEvents
});

printSingleCallProof(call);
process.stdout.write(`Artifacts written:\n- ${artifactFiles.receipts}\n- ${artifactFiles.logs}\n- ${artifactFiles.events}\n- ${artifactFiles.summary}\n`);

