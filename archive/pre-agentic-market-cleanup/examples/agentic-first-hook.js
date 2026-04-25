import { createAgenticTrustClient, UnsafeExecutorError } from "../packages/trust-sdk/agentic-hook.mjs";

const trustClient = createAgenticTrustClient({
  baseUrl: process.env.INFOPUNKS_TRUST_API_URL,
  apiKey: process.env.INFOPUNKS_API_KEY,
  minTrustScore: Number(process.env.INFOPUNKS_MIN_TRUST_SCORE ?? 50),
  minConfidence: Number(process.env.INFOPUNKS_MIN_CONFIDENCE ?? 0.5)
});

function pickExecutor(executors) {
  return executors[0];
}

async function executeWithAgenticFirstHook() {
  const candidateExecutors = [
    { subject_id: "agent_001", run: async () => "executor_result:ok" },
    { subject_id: "agent_002", run: async () => "executor_result:ok" }
  ];

  const selected = pickExecutor(candidateExecutors);

  try {
    const decision = await trustClient.requireTrustedExecutor({
      subject_id: selected.subject_id,
      context: {
        task_type: "agentic.market.execution",
        domain: "general",
        risk_level: "medium"
      }
    });

    const executionResult = await selected.run();
    console.log(JSON.stringify({
      step: "executor-executed",
      subject_id: selected.subject_id,
      trust_decision: decision,
      execution_result: executionResult
    }, null, 2));
  } catch (error) {
    if (error instanceof UnsafeExecutorError || error?.code === "UNSAFE_EXECUTOR") {
      console.error(JSON.stringify({
        step: "executor-blocked",
        code: error.code,
        message: error.message,
        decision: error.decision ?? null
      }, null, 2));
      process.exitCode = 2;
      return;
    }

    console.error(JSON.stringify({
      step: "trust-check-failed",
      code: error?.code ?? "TRUST_CHECK_FAILED",
      message: error?.message ?? "Unknown error",
      details: error?.details ?? null
    }, null, 2));
    process.exitCode = 1;
  }
}

await executeWithAgenticFirstHook();
