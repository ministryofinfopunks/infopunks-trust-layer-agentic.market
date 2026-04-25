import { loadEnv } from "../../services/mcp-adapter/src/config/env.mjs";
import { createAdapterStateStore } from "../../services/mcp-adapter/src/storage/factory.mjs";
import { createWarRoomFeed } from "../../services/mcp-adapter/src/observability/war-room-feed.mjs";

function isoOffset(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const config = loadEnv();
const store = await createAdapterStateStore(config);
const feed = createWarRoomFeed({
  store,
  config,
  logger: {
    warn(payload) {
      console.warn(JSON.stringify(payload));
    }
  }
});

const seedEvents = [
  {
    event_type: "paid_call.success",
    timestamp: isoOffset(5),
    payer: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    subject_id: "agent_001",
    trust_score: 71,
    trust_tier: "watch",
    mode: "verified",
    confidence: 0.87,
    status: "success",
    receipt_id: "xrc_seed_001",
    amount: 1,
    reason: "seed_success"
  },
  {
    event_type: "paid_call.payment_failed",
    timestamp: isoOffset(4),
    payer: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    subject_id: "agent_002",
    mode: "verified",
    status: "failed",
    receipt_id: null,
    amount: 1,
    error_code: "PAYMENT_VERIFICATION_FAILED",
    reason: "seed_failed_payment"
  },
  {
    event_type: "paid_call.replay_rejected",
    timestamp: isoOffset(3),
    payer: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    subject_id: "agent_001",
    mode: "verified",
    status: "rejected",
    amount: 1,
    error_code: "REPLAY_DETECTED",
    reason: "seed_replay"
  },
  {
    event_type: "paid_call.degraded_fallback",
    timestamp: isoOffset(2),
    payer: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    subject_id: "agent_003",
    trust_score: 42,
    trust_tier: "unverified",
    mode: "degraded",
    confidence: 0.31,
    status: "degraded",
    receipt_id: "xrc_seed_003",
    amount: 1,
    reason: "SAFE_DEFAULT_FALLBACK"
  },
  {
    event_type: "paid_call.unsafe_executor_blocked",
    timestamp: isoOffset(1),
    payer: "0x4cC773d286E5aA52591E9E6ebed062cC057C441E",
    subject_id: "agent_004",
    trust_score: 18,
    trust_tier: "quarantined",
    mode: "verified",
    confidence: 0.9,
    status: "blocked",
    receipt_id: "xrc_seed_004",
    amount: 1,
    reason: "policy_blocked"
  }
];

for (const event of seedEvents) {
  await feed.record(event);
}

const latest = await feed.listLatest(50);
console.log(JSON.stringify({
  seeded: seedEvents.length,
  stored: latest.length,
  endpoint: "/api/war-room/events"
}, null, 2));
