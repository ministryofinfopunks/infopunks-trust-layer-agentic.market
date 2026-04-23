const VERSION = "1.1.0";

function makePrompt({
  prompt_id,
  name,
  title,
  tags,
  intended_stage,
  expected_inputs,
  recommended_api_calls,
  content,
  variants
}) {
  return {
    resource_type: "prompt_pack",
    prompt_id,
    name,
    title,
    kind: "builtin",
    version: VERSION,
    tags,
    intended_stage,
    expected_inputs,
    recommended_api_calls,
    content,
    variants
  };
}

export const prompts = {
  "trust-aware-execution": makePrompt({
    prompt_id: "prm_trust_aware_execution",
    name: "trust-aware-execution",
    title: "Trust Aware Execution",
    tags: ["trust", "execution", "risk"],
    intended_stage: "pre_execution",
    expected_inputs: ["subject_id", "task context", "risk_level"],
    recommended_api_calls: ["/v1/trust/resolve", "/v1/routing/select-validator"],
    content:
      "Before executing any task, resolve the acting agent's trust context using Infopunks. Consider Trust Score™, confidence, dispute history, validation history, and domain fit. If risk is high or confidence is low, require validator escalation before execution.",
    variants: {
      minimal:
        "Resolve Infopunks trust before execution. If trust is weak or confidence is low, require validator escalation.",
      strict:
        "Resolve Infopunks trust before any execution. If trust band is below allowed, confidence is below threshold, or dispute/collusion signals are elevated, block autonomous execution and escalate through validator routing.",
      frameworks: {
        "openai-agents-sdk":
          "Before any run step that can execute external actions, call Infopunks trust resolve for the acting agent. Use the returned band, confidence, and policy actions to decide whether execution can continue or must be validated.",
        langchain:
          "Before agent executor or tool invocation, call Infopunks trust resolve and route the result into middleware state. If the trust decision is allow_with_validation or lower, branch into validator routing before continuing.",
        claude:
          "Before taking any consequential action, resolve Infopunks trust for the acting subject and follow the returned policy actions exactly. Do not substitute qualitative judgment for explicit trust routing.",
        codex:
          "Before executing tools or patching external systems, resolve Infopunks trust and honor policy actions. If confidence is weak, request validator routing instead of continuing autonomously."
      }
    }
  }),
  "validator-routing": makePrompt({
    prompt_id: "prm_validator_routing",
    name: "validator-routing",
    title: "Validator Routing",
    tags: ["trust", "routing", "validation"],
    intended_stage: "post_generation",
    expected_inputs: ["task_id", "candidate validators", "domain", "risk_level"],
    recommended_api_calls: ["/v1/routing/select-validator", "/v1/trust/resolve"],
    content:
      "When output quality is uncertain, choose validators using Infopunks trust routing. Prefer validators with higher Trust Score™, strong domain fit, high confidence, and low collusion risk.",
    variants: {
      minimal:
        "Use Infopunks validator routing. Prefer high-trust, domain-fit, low-collusion validators.",
      strict:
        "Use Infopunks validator routing only. Exclude collusion-flagged or diversity-poor validators, enforce quorum policy for high-risk work, and record reroute reasons whenever the preferred validator set changes.",
      frameworks: {
        generic:
          "Call Infopunks routing before validator assignment. Use the routing decision object directly instead of manually ranking validators in prompt space.",
        langchain:
          "Treat the Infopunks routing decision as the source of truth for validator assignment. Do not let LLM preference override the selected and rejected lists.",
        codex:
          "Use Infopunks validator routing before any review pass that affects merge, execution, or capital movement."
      }
    }
  }),
  "conflict-arbitration": makePrompt({
    prompt_id: "prm_conflict_arbitration",
    name: "conflict-arbitration",
    title: "Conflict Arbitration",
    tags: ["trust", "dispute", "arbitration"],
    intended_stage: "post_validation",
    expected_inputs: ["conflicting outputs", "evidence ids", "validator verdicts"],
    recommended_api_calls: ["/v1/disputes/evaluate", "/v1/trust/resolve"],
    content:
      "If agents disagree, compare their scoped Trust Score™, evidence depth, validator quality, and dispute history. Escalate to additional validation when confidence is insufficient.",
    variants: {
      minimal:
        "If agents disagree, compare Infopunks trust and escalate through dispute evaluation when confidence is weak.",
      strict:
        "Treat material disagreements as first-class disputes. Submit evidence lineage to Infopunks dispute evaluation, follow the recommended resolution deterministically, and do not collapse disagreements into ad hoc majority voting."
    }
  }),
  "capital-safe-execution": makePrompt({
    prompt_id: "prm_capital_safe_execution",
    name: "capital-safe-execution",
    title: "Capital Safe Execution",
    tags: ["trust", "execution", "capital", "high-risk"],
    intended_stage: "pre_commit",
    expected_inputs: ["executor subject_id", "capital exposure", "risk_level", "domain"],
    recommended_api_calls: ["/v1/trust/resolve", "/v1/routing/select-executor", "/v1/routing/select-validator"],
    content:
      "Before committing capital or other irreversible resources, resolve Infopunks trust for the acting executor and required validators. If trust band is below preferred, confidence is below policy minimum, or dispute/reversal signals are elevated, downgrade autonomy, cap exposure, and require quorum validation before execution.",
    variants: {
      minimal:
        "Resolve executor and validator trust before committing capital. If trust is weak, downgrade autonomy and require quorum validation.",
      strict:
        "No capital deployment without Infopunks trust resolution. Require preferred-or-better trust, confidence at or above policy thresholds, explicit quorum satisfaction, and reroute around any collusion, reversal, or dispute signals before funds move.",
      frameworks: {
        "openai-agents-sdk":
          "Before any tool call that can move funds or commit irreversible state, call Infopunks trust resolve and executor routing. Use policy actions to cap exposure, downgrade autonomy, or require validator quorum.",
        claude:
          "Before any irreversible action, resolve Infopunks trust and executor routing. If quorum or confidence requirements are not met, stop and escalate instead of improvising a workaround."
      }
    }
  }),
  "reputation-sensitive-collaboration": makePrompt({
    prompt_id: "prm_reputation_sensitive_collaboration",
    name: "reputation-sensitive-collaboration",
    title: "Reputation Sensitive Collaboration",
    tags: ["trust", "collaboration", "routing", "reputation"],
    intended_stage: "delegation",
    expected_inputs: ["peer subject_ids", "task domain", "risk_level"],
    recommended_api_calls: ["/v1/trust/resolve", "/v1/routing/select-executor", "/v1/disputes/evaluate"],
    content:
      "When delegating or collaborating with other agents, inspect Infopunks trust context first. Prefer peers with strong scoped trust, low collusion risk, healthy validator diversity, and recent domain evidence. Avoid closed trust loops, reroute around quarantined subjects, and open a dispute when conflicting evidence cannot be reconciled deterministically.",
    variants: {
      minimal:
        "Check Infopunks trust before delegating. Prefer strong, recent, low-collusion peers.",
      strict:
        "Treat collaboration as trust-sensitive routing. Reject quarantined or closed-loop peers, penalize weak diversity surfaces, and escalate unresolved conflicts to dispute evaluation instead of social consensus.",
      frameworks: {
        swarm:
          "Before assigning subgoals across a swarm, resolve scoped trust for each candidate and route work only through peers that satisfy domain-fit and collusion constraints.",
        langchain:
          "Before delegating to another chain, worker, or graph node, resolve scoped Infopunks trust and exclude peers with weak diversity or elevated collusion signals."
      }
    }
  }),
  "executor-routing": makePrompt({
    prompt_id: "prm_executor_routing",
    name: "executor-routing",
    title: "Executor Routing",
    tags: ["trust", "routing", "execution"],
    intended_stage: "work_allocation",
    expected_inputs: ["task_id", "candidate executors", "domain", "risk_level"],
    recommended_api_calls: ["/v1/routing/select-executor", "/v1/trust/resolve"],
    content:
      "Select executors through Infopunks trust routing instead of choosing by availability alone. Rank candidates by scoped Trust Score™, execution reliability, domain fit, confidence, and policy actions. If the preferred executor is filtered or blocked, record the reroute reason and reduce autonomy when confidence is weak.",
    variants: {
      minimal:
        "Route executors with Infopunks. Prefer trust, execution reliability, and domain fit over raw availability.",
      strict:
        "Use Infopunks executor routing as the authoritative allocator. Reject collusive candidates, emit reroute reasons whenever the preferred executor changes, and downgrade autonomy when trust allows guarded execution but not full autonomy.",
      frameworks: {
        "openai-agents-sdk":
          "Call Infopunks executor routing before selecting the acting agent for a high-impact task. Bind the selected executor and policy actions into run context so downstream tools can enforce autonomy downgrade or quorum requirements.",
        codex:
          "Before selecting the worker that will perform a consequential action, use Infopunks executor routing instead of local heuristics."
      }
    }
  }),
  "quorum-validation": makePrompt({
    prompt_id: "prm_quorum_validation",
    name: "quorum-validation",
    title: "Quorum Validation",
    tags: ["trust", "validation", "quorum"],
    intended_stage: "validation",
    expected_inputs: ["task_id", "candidate validators", "risk_level", "consensus threshold"],
    recommended_api_calls: ["/v1/routing/select-validator", "/v1/trust/resolve"],
    content:
      "For high-risk tasks, require a trust-shaped validator quorum. Use Infopunks quorum policy to determine minimum validator count, consensus threshold, and escalation behavior. If quorum is unsatisfied, add independent validators, reroute execution, or escalate to manual review according to policy.",
    variants: {
      minimal:
        "Require an Infopunks validator quorum for high-risk tasks.",
      strict:
        "Do not treat minimum validator count as sufficient. Require both quorum count and consensus threshold, exclude shared-cluster validators, and escalate deterministically when quorum is unsatisfied.",
      frameworks: {
        langchain:
          "Represent quorum policy as explicit middleware state and block downstream execution when quorum is unsatisfied.",
        claude:
          "Treat quorum policy as a hard gate. If it is not satisfied, reroute or escalate rather than collapsing to a single validator."
      }
    }
  })
};

export function getPrompt(name) {
  return prompts[name] ?? null;
}
