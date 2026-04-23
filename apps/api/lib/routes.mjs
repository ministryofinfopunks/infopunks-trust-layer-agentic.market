import path from "node:path";
import { defineRoute } from "./http.mjs";
import { notFoundError } from "./errors.mjs";
import { schemas } from "./validation.mjs";
import { shapePromptPack } from "./contracts.mjs";
import { generatedOperationScopes } from "./generated-openapi.mjs";

function startEventStream({ platform, query, authContext, req }) {
  const since = Number(query.since);
  const streamQuery = Number.isFinite(since) && since >= 0 ? { ...query, since } : query;

  return {
    kind: "stream",
    statusCode: 200,
    start(res) {
      const releaseStream = platform.openEventStream(authContext);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-store, must-revalidate",
        "x-content-type-options": "nosniff",
        connection: "keep-alive"
      });
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

      const send = (event) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      for (const event of platform.getEvents({ since: streamQuery.since })) {
        if (platform.eventMatchesFilter(event, streamQuery)) {
          send(event);
        }
      }

      const heartbeat = setInterval(() => {
        res.write(`event: heartbeat\ndata: {"ts":"${new Date().toISOString()}"}\n\n`);
      }, 15000);
      heartbeat.unref?.();

      const cleanup = platform.addStream({
        matches: (event) => platform.eventMatchesFilter(event, streamQuery),
        send
      });

      let closed = false;
      const finalize = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(heartbeat);
        cleanup();
        releaseStream();
      };

      res.once("close", finalize);
      res.once("error", finalize);
      req?.once?.("aborted", finalize);
    }
  };
}

export function buildRoutes({ platform, warRoomRoot }) {
  const warRoomIndex = path.join(warRoomRoot, "index.html");
  const warRoomScript = path.join(warRoomRoot, "app.js");
  const warRoomStyles = path.join(warRoomRoot, "styles.css");

  return [
    defineRoute({
      id: "healthz",
      method: "GET",
      path: "/healthz",
      auth: false,
      handler: async () => ({
        statusCode: 200,
        body: { ok: true, service: "infopunks-trust-layer" }
      })
    }),
    defineRoute({
      id: "metrics",
      method: "GET",
      path: "/metrics",
      auth: false,
      handler: async () => ({
        kind: "text",
        statusCode: 200,
        headers: { "content-type": "text/plain; version=0.0.4" },
        text: platform.getPrometheusMetrics()
      })
    }),
    defineRoute({
      id: "war-room.index",
      method: "GET",
      path: "/",
      auth: false,
      handler: async ({ serveFile }) => serveFile(warRoomIndex, "text/html; charset=utf-8")
    }),
    defineRoute({
      id: "war-room.index.named",
      method: "GET",
      path: "/war-room",
      auth: false,
      handler: async ({ serveFile }) => serveFile(warRoomIndex, "text/html; charset=utf-8")
    }),
    defineRoute({
      id: "war-room.asset.js",
      method: "GET",
      path: "/war-room/app.js",
      auth: false,
      handler: async ({ serveFile }) => serveFile(warRoomScript, "application/javascript; charset=utf-8")
    }),
    defineRoute({
      id: "war-room.asset.css",
      method: "GET",
      path: "/war-room/styles.css",
      auth: false,
      handler: async ({ serveFile }) => serveFile(warRoomStyles, "text/css; charset=utf-8")
    }),
    defineRoute({
      id: "budget.quote",
      method: "POST",
      path: "/v1/budget/quote",
      auth: { requiredScope: generatedOperationScopes["POST /v1/budget/quote"] },
      rateLimit: { bucket: "read" },
      bodySchema: schemas.budgetQuote,
      handler: async ({ body, authContext }) => ({
        statusCode: 200,
        body: platform.quoteBudget(body, authContext)
      })
    }),
    defineRoute({
      id: "passports.create",
      method: "POST",
      path: "/v1/passports",
      auth: { requiredScope: generatedOperationScopes["POST /v1/passports"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.passportCreate,
      handler: async ({ body, req }) => ({
        statusCode: 201,
        body: platform.createPassport(body, req.headers["idempotency-key"])
      })
    }),
    defineRoute({
      id: "passports.get",
      method: "GET",
      path: "/v1/passports/:subjectId",
      auth: { requiredScope: generatedOperationScopes["GET /v1/passports/{subjectId}"] },
      rateLimit: { bucket: "read" },
      handler: async ({ params }) => {
        const passport = platform.getPassport(params.subjectId);
        if (!passport) {
          throw notFoundError({ subject_id: params.subjectId });
        }
        return {
          statusCode: 200,
          body: passport
        };
      }
    }),
    defineRoute({
      id: "passports.rotate-key",
      method: "POST",
      path: "/v1/passports/:subjectId/rotate-key",
      auth: { requiredScope: generatedOperationScopes["POST /v1/passports/{subjectId}/rotate-key"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.passportRotateKey,
      handler: async ({ params, body }) => ({
        statusCode: 200,
        body: platform.rotatePassportKey(params.subjectId, body)
      })
    }),
    defineRoute({
      id: "evidence.create",
      method: "POST",
      path: "/v1/evidence",
      auth: { requiredScope: generatedOperationScopes["POST /v1/evidence"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.evidenceCreate,
      handler: async ({ body, req }) => ({
        statusCode: 202,
        body: platform.recordEvidence(body, req.headers["idempotency-key"])
      })
    }),
    defineRoute({
      id: "webhooks.create",
      method: "POST",
      path: "/v1/webhooks",
      auth: { requiredScope: generatedOperationScopes["POST /v1/webhooks"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.webhookCreate,
      handler: async ({ body }) => ({
        statusCode: 201,
        body: platform.createWebhook(body)
      })
    }),
    defineRoute({
      id: "portability.export",
      method: "POST",
      path: "/v1/portability/export",
      auth: { requiredScope: generatedOperationScopes["POST /v1/portability/export"] },
      rateLimit: { bucket: "read" },
      bodySchema: schemas.portabilityExport,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.exportTrustBundle(body)
      })
    }),
    defineRoute({
      id: "portability.import",
      method: "POST",
      path: "/v1/portability/import",
      auth: { requiredScope: generatedOperationScopes["POST /v1/portability/import"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.portabilityImport,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.importTrustBundle(body)
      })
    }),
    defineRoute({
      id: "disputes.evaluate",
      method: "POST",
      path: "/v1/disputes/evaluate",
      auth: { requiredScope: generatedOperationScopes["POST /v1/disputes/evaluate"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.disputeEvaluate,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.evaluateDispute(body)
      })
    }),
    defineRoute({
      id: "trust.resolve",
      method: "POST",
      path: "/v1/trust/resolve",
      auth: { requiredScope: generatedOperationScopes["POST /v1/trust/resolve"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.trustResolve,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.resolveTrust(body)
      })
    }),
    defineRoute({
      id: "routing.select-validator",
      method: "POST",
      path: "/v1/routing/select-validator",
      auth: { requiredScope: generatedOperationScopes["POST /v1/routing/select-validator"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.routingSelectValidator,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.selectValidators(body)
      })
    }),
    defineRoute({
      id: "routing.select-executor",
      method: "POST",
      path: "/v1/routing/select-executor",
      auth: { requiredScope: generatedOperationScopes["POST /v1/routing/select-executor"] },
      rateLimit: { bucket: "write" },
      bodySchema: schemas.routingSelectExecutor,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.selectExecutors(body)
      })
    }),
    defineRoute({
      id: "economic.escrow-quote",
      method: "POST",
      path: "/v1/economic/escrow-quote",
      auth: { requiredScope: generatedOperationScopes["POST /v1/economic/escrow-quote"] },
      rateLimit: { bucket: "read" },
      bodySchema: schemas.economicEscrowQuote,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.getEscrowQuote(body)
      })
    }),
    defineRoute({
      id: "economic.risk-price",
      method: "POST",
      path: "/v1/economic/risk-price",
      auth: { requiredScope: generatedOperationScopes["POST /v1/economic/risk-price"] },
      rateLimit: { bucket: "read" },
      bodySchema: schemas.economicRiskPrice,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.getRiskPriceQuote(body)
      })
    }),
    defineRoute({
      id: "economic.attestation-bundle",
      method: "POST",
      path: "/v1/economic/attestation-bundle",
      auth: { requiredScope: generatedOperationScopes["POST /v1/economic/attestation-bundle"] },
      rateLimit: { bucket: "read" },
      bodySchema: schemas.economicAttestationBundle,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: platform.getAttestationBundle(body)
      })
    }),
    defineRoute({
      id: "events.stream",
      method: "GET",
      path: "/v1/events/stream",
      auth: { requiredScope: generatedOperationScopes["GET /v1/events/stream"] },
      rateLimit: { bucket: "stream" },
      handler: async ({ query, authContext, req }) => startEventStream({ platform, query, authContext, req })
    }),
    defineRoute({
      id: "traces.get",
      method: "GET",
      path: "/v1/traces/:traceId",
      auth: { requiredScope: generatedOperationScopes["GET /v1/traces/{traceId}"] },
      rateLimit: { bucket: "read" },
      handler: async ({ params }) => ({
        statusCode: 200,
        body: platform.getTrace(params.traceId)
      })
    }),
    defineRoute({
      id: "trust.explain",
      method: "GET",
      path: "/v1/trust/:subjectId/explain",
      auth: { requiredScope: generatedOperationScopes["GET /v1/trust/{subjectId}/explain"] },
      rateLimit: { bucket: "read" },
      handler: async ({ params, query }) => ({
        statusCode: 200,
        body: platform.explainTrust(params.subjectId, query)
      })
    }),
    defineRoute({
      id: "prompts.get",
      method: "GET",
      path: "/v1/prompts/:name",
      auth: { requiredScope: generatedOperationScopes["GET /v1/prompts/{name}"] },
      rateLimit: { bucket: "read" },
      handler: async ({ params }) => ({
        statusCode: 200,
        body: shapePromptPack(platform.getPrompt(params.name))
      })
    }),
    defineRoute({
      id: "war-room.state",
      method: "GET",
      path: "/v1/war-room/state",
      auth: { requiredScope: generatedOperationScopes["GET /v1/war-room/state"] },
      rateLimit: { bucket: "read" },
      handler: async () => ({
        statusCode: 200,
        body: platform.getWarRoomState()
      })
    }),
    defineRoute({
      id: "sim.run",
      method: "POST",
      path: "/v1/sim/run",
      auth: { requiredScope: generatedOperationScopes["POST /v1/sim/run"] },
      rateLimit: { bucket: "sim" },
      bodySchema: schemas.simRun,
      handler: async ({ body }) => ({
        statusCode: 200,
        body: await platform.runScenario(body)
      })
    })
  ];
}
