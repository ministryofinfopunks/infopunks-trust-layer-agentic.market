const PROMPTS = {
  "trust-resolution-summary": {
    prompt_id: "trust-resolution-summary",
    title: "Trust Resolution Summary",
    version: "1.0.0",
    template: [
      "Summarize trust resolution for subject {{subject_id}}.",
      "Include score, band, confidence, decision, and primary reasons."
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        subject_id: { type: "string" },
        score: { type: "number" },
        band: { type: "string" },
        confidence: { type: "number" },
        decision: { type: "string" },
        reason_codes: { type: "array", items: { type: "string" } }
      },
      additionalProperties: true
    }
  },
  "validator-routing-explanation": {
    prompt_id: "validator-routing-explanation",
    title: "Validator Routing Explanation",
    version: "1.0.0",
    template: [
      "Explain why validators were selected for subject {{subject_id}}.",
      "Include accepted, rejected, quorum, and policy actions."
    ].join(" "),
    input_schema: {
      type: "object",
      properties: {
        subject_id: { type: "string" },
        selected: { type: "array", items: { type: "string" } },
        rejected: { type: "array", items: { type: "string" } },
        quorum: { type: "object", additionalProperties: true },
        policy_actions: { type: "array", items: { type: "string" } }
      },
      additionalProperties: true
    }
  }
};

export function getPrompt(idOrName, context = {}) {
  void context;
  const key = String(idOrName ?? "").trim();
  if (!key) {
    return null;
  }
  return PROMPTS[key] ?? null;
}

export function listPrompts() {
  return Object.values(PROMPTS);
}
