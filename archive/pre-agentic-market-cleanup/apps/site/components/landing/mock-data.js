export const heroFeedSeed = [
  {
    id: "hero_1",
    label: "trust collapse",
    agent: "agent_221",
    change: -35,
    band: "quarantined",
    state: "collapse",
    detail: "Validator reversal detected on settlement review."
  },
  {
    id: "hero_2",
    label: "route changed",
    agent: "agent_044",
    change: 14,
    band: "preferred",
    state: "routed",
    detail: "Three high-risk tasks moved into a preferred validation lane."
  },
  {
    id: "hero_3",
    label: "trust penalty",
    agent: "agent_119",
    change: -11,
    band: "watch",
    state: "penalized",
    detail: "Latency breach pushed the execution outside the trust budget."
  },
  {
    id: "hero_4",
    label: "validation cleared",
    agent: "agent_318",
    change: 9,
    band: "preferred",
    state: "routed",
    detail: "Deterministic replay matched the evidence bundle under review."
  },
  {
    id: "hero_5",
    label: "validator reject",
    agent: "agent_082",
    change: -21,
    band: "restricted",
    state: "collapse",
    detail: "Replay mismatch blocked a low-confidence output from shipping."
  },
  {
    id: "hero_6",
    label: "trust recovery",
    agent: "agent_907",
    change: 12,
    band: "stable",
    state: "routed",
    detail: "Secondary attestation landed and restored routing eligibility."
  }
];

export const systemFeatures = [
  {
    id: "passport",
    index: "01",
    title: "Passport",
    blurb: "Who the agent is, signed and scoped to a known subject.",
    action: "Register agent"
  },
  {
    id: "evidence",
    index: "02",
    title: "Evidence",
    blurb: "What the agent did, recorded as machine-readable proof.",
    action: "Record evidence"
  },
  {
    id: "trust",
    index: "03",
    title: "Trust",
    blurb: "Whether the agent should still be selected right now.",
    action: "Resolve trust"
  },
  {
    id: "routing",
    index: "04",
    title: "Routing",
    blurb: "Who gets the next task when trust shifts under load.",
    action: "Route work"
  },
  {
    id: "events",
    index: "05",
    title: "Events",
    blurb: "What changed, streamed out as deterministic system signals.",
    action: "Subscribe to trust events"
  }
];

export const heroInstallSummary = {
  install: ["SDK", "REST API", "Event stream", "Prompt packs"],
  get: ["Passport identity", "Trust resolution", "Validator routing", "Live trust events"]
};

export const integrationTargets = [
  "OpenAI Agents SDK",
  "LangChain",
  "AutoGen",
  "Custom agent runtimes",
  "REST-first systems"
];

export const installSteps = [
  "npm install @infopunks/trust-sdk",
  "register a Passport",
  "record Evidence",
  "resolve Trust",
  "route Validators",
  "subscribe to trust events"
];

export const trustResponseExample = [
  "{",
  "  \"score\": 67,",
  "  \"band\": \"watch\",",
  "  \"decision\": \"allow_with_validation\",",
  "  \"recommended_validators\": [\"agent_784\"],",
  "  \"trace_id\": \"trc_01JX...\"",
  "}"
];

export const trustEventCards = [
  {
    id: "collapse",
    type: "collapse",
    title: "Trust collapse",
    agent: "agent_221",
    timestamp: "00:12:08 UTC",
    scoreFrom: 92,
    scoreTo: 57,
    delta: -35,
    summary: "Validator reversal forced the band below the execution threshold."
  },
  {
    id: "reroute",
    type: "reroute",
    title: "Reroute",
    agent: "trace_trc_02",
    timestamp: "00:12:10 UTC",
    routeFrom: "agent_221",
    routeTo: "agent_044",
    details: ["quarantined source", "validator quorum intact", "fallback selected in 240ms"],
    summary: "High-value work moved to a preferred validator without human intervention."
  },
  {
    id: "reject",
    type: "reject",
    title: "Validator reject",
    agent: "agent_082",
    timestamp: "00:12:13 UTC",
    chip: "rejected",
    summary: "Replay mismatch denied attestation and blocked downstream routing."
  }
];

export const usagePanels = [
  {
    id: "select",
    title: "Trust before execution",
    body: "Resolve trust before execution and only let preferred bands take risk-bearing work.",
    activeLines: [0, 1, 2]
  },
  {
    id: "route",
    title: "Auto validator routing",
    body: "When trust drops under pressure, route work into a higher-confidence validator pool instead of guessing.",
    activeLines: [1, 2, 3, 4, 5]
  },
  {
    id: "subscribe",
    title: "Event subscription",
    body: "Subscribe to trust collapse as a first-class machine event and fold it back into orchestration immediately.",
    activeLines: [8, 9, 10]
  },
  {
    id: "policy",
    title: "Prompt layer",
    body: "Trust now participates in the agent's reasoning loop before work begins, not after failure has already propagated.",
    activeLines: [0, 1, 8, 9]
  }
];

export const eventLogSeed = [
  {
    id: "log_1",
    type: "trust.spike",
    text: "00:12:07 trust.spike subject=agent_044 band=preferred delta=+14 source=validator_consensus"
  },
  {
    id: "log_2",
    type: "route.changed",
    text: "00:12:08 route.changed trace=trc_02 from=agent_221 to=agent_044 reason=quarantine"
  },
  {
    id: "log_3",
    type: "trust.collapse",
    text: "00:12:09 trust.collapse subject=agent_221 delta=-35 reason=validator_reversal"
  },
  {
    id: "log_4",
    type: "quarantine.enforced",
    text: "00:12:10 quarantine.enforced subject=agent_221 tasks_rerouted=3"
  },
  {
    id: "log_5",
    type: "validator.reject",
    text: "00:12:11 validator.reject subject=agent_082 trace=trc_03 cause=replay_mismatch"
  },
  {
    id: "log_6",
    type: "trust.resolve",
    text: "00:12:12 trust.resolve subject=agent_318 band=preferred score=0.93"
  },
  {
    id: "log_7",
    type: "route.changed",
    text: "00:12:13 route.changed trace=trc_05 selected=agent_553 quorum=majority"
  },
  {
    id: "log_8",
    type: "trust.collapse",
    text: "00:12:14 trust.collapse subject=agent_082 delta=-21 cause=replay_divergence"
  }
];

export const usageExample = [
  "if ((await ip.trust.resolve(task)).band !== \"preferred\") {",
  "  await ip.routing.selectValidator({",
  "    traceId: task.traceId,",
  "    candidatePool: [\"agent_044\", \"agent_553\", \"agent_318\"],",
  "    reason: \"high_risk_execution\"",
  "  });",
  "}",
  "",
  "ip.events.subscribe(\"trust.collapse\", (event) => {",
  "  console.log(event.subjectId, event.delta);",
  "});"
];

export const installSnippet = [
  "npm install @infopunks/trust-sdk",
  "",
  "import { Infopunks } from \"@infopunks/trust-sdk\";",
  "",
  "const ip = new Infopunks({",
  "  apiKey: process.env.INFOPUNKS_API_KEY,",
  "});",
  "",
  "// 1. Register agent",
  "await ip.passports.register({ subjectId: \"agent_221\" });",
  "",
  "// 2. Record evidence",
  "await ip.evidence.record({ traceId: \"trc_014\", class: \"validator_outcome\" });",
  "",
  "// 3. Resolve trust",
  "const trust = await ip.trust.resolve({ traceId: \"trc_014\", subjectId: \"agent_221\" });",
  "",
  "// 4. Route work",
  "const route = await ip.routing.selectValidator({ traceId: \"trc_014\" });",
  "",
  "// 5. Subscribe to live trust events",
  "ip.events.subscribe(\"trust.collapse\", console.log);"
];

export const networkNodes = [
  { id: "Executor", x: 16, y: 22, tone: "neutral" },
  { id: "Validator", x: 68, y: 18, tone: "neutral" },
  { id: "Capital", x: 78, y: 64, tone: "neutral" },
  { id: "Replay", x: 44, y: 78, tone: "neutral" },
  { id: "Evidence", x: 22, y: 58, tone: "neutral" },
  { id: "Trust", x: 48, y: 44, tone: "accent" }
];

export const networkEdges = [
  { id: "edge_1", from: [16, 22], to: [48, 44], hot: false },
  { id: "edge_2", from: [22, 58], to: [48, 44], hot: false },
  { id: "edge_3", from: [48, 44], to: [68, 18], hot: true },
  { id: "edge_4", from: [48, 44], to: [78, 64], hot: true },
  { id: "edge_5", from: [44, 78], to: [78, 64], hot: false }
];
