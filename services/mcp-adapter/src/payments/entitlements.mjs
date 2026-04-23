import { TOOL_PRICING } from "../config/pricing.mjs";
import { makeAdapterError } from "../schemas/error-schema.mjs";

export class EntitlementService {
  constructor({ verifier, store, config, logger, metrics = null }) {
    this.verifier = verifier;
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  async authorizeAndBill({ operation, payment, fallbackPayer, spendLimitUnits, adapterTraceId, entitlement }) {
    const pricing = TOOL_PRICING[operation] ?? { mode: "free", units: 0 };
    const requiredUnits = pricing.mode === "metered" ? pricing.units : 0;
    const payer = payment?.payer ?? fallbackPayer ?? entitlement?.payer ?? "anonymous";

    if (requiredUnits === 0 || !this.config.x402RequiredDefault) {
      return {
        billed_units: 0,
        payer,
        payment_receipt_id: null,
        x402_receipt: null,
        spend_controls: await this.store.spendState(payer)
      };
    }

    const paymentAsset = typeof payment?.asset === "string" ? payment.asset.toUpperCase() : null;
    const paymentNetwork = typeof payment?.network === "string" ? payment.network.toLowerCase() : null;
    const acceptedAssets = this.config.x402AcceptedAssets ?? ["USDC"];
    const supportedNetworks = this.config.x402SupportedNetworks ?? ["eip155:84532"];

    if (this.config.x402RequirePaymentAsset && !paymentAsset) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Payment asset is required.",
        { accepted_assets: acceptedAssets },
        false,
        402
      );
    }
    if (paymentAsset && !acceptedAssets.includes(paymentAsset)) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Unsupported payment asset.",
        { received_asset: paymentAsset, accepted_assets: acceptedAssets },
        false,
        402
      );
    }
    if (this.config.x402RequirePaymentNetwork && !paymentNetwork) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Payment network is required.",
        { supported_networks: supportedNetworks },
        false,
        402
      );
    }
    if (paymentNetwork && !supportedNetworks.includes(paymentNetwork)) {
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Unsupported payment network.",
        { received_network: paymentNetwork, supported_networks: supportedNetworks },
        false,
        402
      );
    }

    const verification = await this.verifier.verify({
      payment,
      requiredUnits,
      operation,
      fallbackPayer: payer,
      adapterTraceId,
      entitlement
    });

    if (!verification.ok) {
      throw makeAdapterError(
        verification.reason ?? "PAYMENT_VERIFICATION_FAILED",
        verification.reason === "ENTITLEMENT_REQUIRED"
          ? `Valid x402 entitlement required for ${operation}.`
          : `x402 payment verification failed for ${operation}.`,
        verification.details ?? {},
        false,
        402
      );
    }

    const limit = Number.isFinite(spendLimitUnits) ? spendLimitUnits : this.config.x402DailySpendLimitUnits;
    const reservation = await this.store.reservePaidOperation({
      nonce: verification.nonce ?? payment?.nonce ?? null,
      proofId: verification.proof_id ?? null,
      sessionId: verification.session_id ?? entitlement?.session_id ?? null,
      payer: verification.payer ?? payer,
      toolName: operation,
      replayWindowSeconds: this.config.x402ReplayWindowSeconds,
      verifierReference: verification.verifier_reference ?? null,
      billedUnits: requiredUnits,
      adapterTraceId,
      metadata: {
        verifier_details: verification.details ?? {},
        settlement_status: verification.settlement_status ?? "provisional"
      },
      spendLimitUnits: limit
    });
    if (!reservation.ok && reservation.reason === "PAYMENT_REPLAY_DETECTED") {
      this.metrics?.inc?.("x402_replay_rejected_total", 1);
      throw makeAdapterError(
        "PAYMENT_REPLAY_DETECTED",
        "Payment proof/session replay detected.",
        reservation.details ?? { operation },
        false,
        409
      );
    }
    if (!reservation.ok && reservation.reason === "ENTITLEMENT_REQUIRED") {
      this.metrics?.inc?.("x402_spend_limit_rejected_total", 1);
      throw makeAdapterError("ENTITLEMENT_REQUIRED", "x402 spend controls blocked this call.", reservation.details ?? {}, false, 402);
    }
    if (!reservation.ok) {
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Payment reservation failed.", reservation.details ?? {}, false, 402);
    }
    const receipt = reservation.receipt;

    this.logger?.info?.({
      event: "billing_applied",
      operation,
      adapter_trace_id: adapterTraceId,
      receipt_id: receipt.receipt_id,
      verifier_reference: receipt.verifier_reference,
      billed_units: requiredUnits,
      payer: receipt.payer
    });
    this.metrics?.inc?.("x402_billed_units_total", requiredUnits);
    this.metrics?.inc?.(`x402_billed_units_${operation}`, requiredUnits);

    return {
      billed_units: requiredUnits,
      payer: receipt.payer,
      payment_receipt_id: receipt.receipt_id,
      x402_receipt: receipt,
      spend_controls: await this.store.spendState(receipt.payer),
      verifier_reference: receipt.verifier_reference,
      proof_id: receipt.proof_id,
      session_id: receipt.session_id
    };
  }
}
