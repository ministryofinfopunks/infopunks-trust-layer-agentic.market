import { TOOL_PRICING } from "../config/pricing.mjs";
import { canonicalAddressForSymbol } from "../config/x402-token-metadata.mjs";
import { makeAdapterError } from "../schemas/error-schema.mjs";

function isHexAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/i.test(value);
}

function normalizeAddress(value) {
  if (!isHexAddress(value)) {
    return null;
  }
  const trimmed = String(value).trim();
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "base") {
    return "eip155:8453";
  }
  if (normalized === "base-sepolia") {
    return "eip155:84532";
  }
  return normalized;
}

function assetAddressForSymbol(symbol, network) {
  const address = canonicalAddressForSymbol(network, symbol);
  return address ? normalizeAddress(address) : null;
}

function normalizeConfiguredAssets(acceptedAssets, network) {
  const normalizedSymbols = new Set();
  const normalizedAddresses = new Set();

  for (const configured of acceptedAssets ?? []) {
    const value = String(configured ?? "").trim();
    if (!value) {
      continue;
    }
    if (isHexAddress(value)) {
      normalizedAddresses.add(normalizeAddress(value));
      continue;
    }
    const symbol = value.toUpperCase();
    normalizedSymbols.add(symbol);
    const mapped = assetAddressForSymbol(symbol, network);
    if (mapped) {
      normalizedAddresses.add(mapped);
    }
  }

  return { normalizedSymbols, normalizedAddresses };
}

function isAcceptedAsset({ paymentAssetRaw, network, acceptedAssets }) {
  if (!paymentAssetRaw) {
    return false;
  }
  const { normalizedSymbols, normalizedAddresses } = normalizeConfiguredAssets(acceptedAssets, network);
  if (isHexAddress(paymentAssetRaw)) {
    return normalizedAddresses.has(normalizeAddress(paymentAssetRaw));
  }
  const symbol = paymentAssetRaw.toUpperCase();
  if (normalizedSymbols.has(symbol)) {
    return true;
  }
  const mapped = assetAddressForSymbol(symbol, network);
  return mapped ? normalizedAddresses.has(mapped) : false;
}

function deriveNonce(payment, payer, operation) {
  if (typeof payment?.nonce === "string" && payment.nonce.trim()) {
    return payment.nonce.trim();
  }
  if (typeof payment?.paymentPayload?.payload?.authorization?.nonce === "string"
    && payment.paymentPayload.payload.authorization.nonce.trim()) {
    return payment.paymentPayload.payload.authorization.nonce.trim();
  }
  const proofId = typeof payment?.proof_id === "string" && payment.proof_id.trim()
    ? payment.proof_id.trim()
    : (typeof payment?.paymentPayload?.proof_id === "string" ? payment.paymentPayload.proof_id.trim() : null);
  if (proofId) {
    return `derived:proof:${proofId}`;
  }
  const reference = typeof payment?.verifier_reference === "string" && payment.verifier_reference.trim()
    ? payment.verifier_reference.trim()
    : null;
  if (reference) {
    return `derived:ref:${reference}`;
  }
  const session = typeof payment?.session_id === "string" && payment.session_id.trim()
    ? payment.session_id.trim()
    : null;
  if (session && payer) {
    return `derived:session:${session}:${payer}:${operation}`;
  }
  return `derived:${payer ?? "anonymous"}:${operation}`;
}

function paidEventBase({
  payer,
  subjectId,
  receiptId,
  amount,
  status,
  nonce,
  idempotencyKey,
  requestHash,
  mode,
  facilitatorProvider,
  network = null,
  payTo = null,
  price = null,
  errorCode = null
}) {
  return {
    payer,
    subject_id: subjectId ?? null,
    receipt_id: receiptId ?? null,
    amount,
    timestamp: new Date().toISOString(),
    status,
    nonce: nonce ?? null,
    idempotency_key: idempotencyKey ?? null,
    request_hash: requestHash ?? null,
    error_code: errorCode,
    mode: mode ?? null,
    facilitator_provider: facilitatorProvider ?? null,
    network,
    payTo,
    price
  };
}

export class EntitlementService {
  constructor({ verifier, store, config, logger, metrics = null }) {
    this.verifier = verifier;
    this.store = store;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
  }

  async authorizeAndBill({
    operation,
    payment,
    fallbackPayer,
    spendLimitUnits,
    adapterTraceId,
    entitlement,
    requestGuard = null,
    subjectId = null
  }) {
    const pricing = TOOL_PRICING[operation] ?? { mode: "free", units: 0 };
    const requiredUnits = pricing.mode === "metered" ? pricing.units : 0;
    const payer = payment?.payer ?? fallbackPayer ?? entitlement?.payer ?? "anonymous";
    const nonce = deriveNonce(payment, payer, operation);
    const guardMeta = requestGuard ?? {};
    const baseEvent = {
      payer,
      subjectId,
      amount: requiredUnits,
      nonce,
      idempotencyKey: guardMeta.idempotencyKey ?? null,
      requestHash: guardMeta.requestHash ?? null,
      mode: guardMeta.mode ?? this.config.x402VerifierMode ?? null,
      facilitatorProvider: this.config.x402FacilitatorProvider ?? "openfacilitator",
      payTo: this.config.x402PayTo ?? null,
      price: this.config.x402Price ?? this.config.x402PriceUsd ?? this.config.x402PricePerUnitAtomic ?? null
    };

    if (requiredUnits === 0 || !this.config.x402RequiredDefault) {
      return {
        billed_units: 0,
        payer,
        payment_receipt_id: null,
        x402_receipt: null,
        spend_controls: await this.store.spendState(payer)
      };
    }

    const paymentAssetRaw = typeof payment?.asset === "string"
      ? payment.asset
      : (typeof payment?.paymentRequirements?.asset === "string" ? payment.paymentRequirements.asset : null);
    const paymentNetwork = normalizeNetwork(
      typeof payment?.network === "string"
        ? payment.network
        : (typeof payment?.paymentRequirements?.network === "string" ? payment.paymentRequirements.network : null)
    );
    const acceptedAssets = this.config.x402AcceptedAssets ?? ["USDC"];
    const supportedNetworks = (this.config.x402SupportedNetworks ?? ["eip155:84532"]).map(normalizeNetwork).filter(Boolean);
    const effectiveNetwork = paymentNetwork ?? supportedNetworks[0] ?? "eip155:84532";
    baseEvent.network = effectiveNetwork;

    if (this.config.x402RequirePaymentAsset && !paymentAssetRaw) {
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "PAYMENT_VERIFICATION_FAILED" })
      });
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Payment asset is required.",
        { accepted_assets: acceptedAssets },
        false,
        402
      );
    }
    if (paymentAssetRaw && !isAcceptedAsset({ paymentAssetRaw, network: effectiveNetwork, acceptedAssets })) {
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "PAYMENT_VERIFICATION_FAILED" })
      });
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Unsupported payment asset.",
        {
          received_asset: paymentAssetRaw,
          accepted_assets: acceptedAssets,
          expected_network: effectiveNetwork
        },
        false,
        402
      );
    }
    if (this.config.x402RequirePaymentNetwork && !paymentNetwork) {
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "PAYMENT_VERIFICATION_FAILED" })
      });
      throw makeAdapterError(
        "PAYMENT_VERIFICATION_FAILED",
        "Payment network is required.",
        { supported_networks: supportedNetworks },
        false,
        402
      );
    }
    if (paymentNetwork && !supportedNetworks.includes(paymentNetwork)) {
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "PAYMENT_VERIFICATION_FAILED" })
      });
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
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({
          ...baseEvent,
          status: "rejected",
          errorCode: verification.reason ?? "PAYMENT_VERIFICATION_FAILED"
        })
      });
      this.logger?.warn?.({
        event: "payment_failed",
        operation,
        adapter_trace_id: adapterTraceId,
        payer,
        subject_id: subjectId ?? null,
        error_code: verification.reason ?? "PAYMENT_VERIFICATION_FAILED"
      });
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
      nonce: verification.nonce ?? nonce,
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
        settlement_status: verification.settlement_status ?? "provisional",
        facilitator_provider: this.config.x402FacilitatorProvider ?? "openfacilitator",
        network: effectiveNetwork,
        payTo: this.config.x402PayTo ?? null,
        price: this.config.x402Price ?? this.config.x402PriceUsd ?? this.config.x402PricePerUnitAtomic ?? null,
        asset: paymentAssetRaw ?? assetAddressForSymbol(acceptedAssets[0], effectiveNetwork) ?? acceptedAssets[0] ?? null
      },
      spendLimitUnits: limit
    });
    if (!reservation.ok && reservation.reason === "PAYMENT_REPLAY_DETECTED") {
      this.metrics?.inc?.("x402_replay_rejected_total", 1);
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "REPLAY_DETECTED" })
      });
      throw makeAdapterError(
        "REPLAY_DETECTED",
        "Payment proof/session replay detected.",
        reservation.details ?? { operation },
        false,
        409
      );
    }
    if (!reservation.ok && reservation.reason === "ENTITLEMENT_REQUIRED") {
      this.metrics?.inc?.("x402_spend_limit_rejected_total", 1);
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "ENTITLEMENT_REQUIRED" })
      });
      throw makeAdapterError("ENTITLEMENT_REQUIRED", "x402 spend controls blocked this call.", reservation.details ?? {}, false, 402);
    }
    if (!reservation.ok) {
      this.logger?.warn?.({
        event: "paid_call_event",
        ...paidEventBase({ ...baseEvent, status: "rejected", errorCode: "PAYMENT_VERIFICATION_FAILED" })
      });
      throw makeAdapterError("PAYMENT_VERIFICATION_FAILED", "Payment reservation failed.", reservation.details ?? {}, false, 402);
    }
    const receipt = reservation.receipt;

    this.logger?.info?.({
      event: "billing_ledger_entry",
      operation,
      adapter_trace_id: adapterTraceId,
      receipt_id: receipt.receipt_id,
      verifier_reference: receipt.verifier_reference,
      billed_units: requiredUnits,
      payer: receipt.payer,
      facilitator_provider: this.config.x402FacilitatorProvider ?? "openfacilitator",
      network: effectiveNetwork,
      payTo: this.config.x402PayTo ?? null,
      price: this.config.x402Price ?? this.config.x402PriceUsd ?? this.config.x402PricePerUnitAtomic ?? null,
      asset: paymentAssetRaw ?? assetAddressForSymbol(acceptedAssets[0], effectiveNetwork) ?? acceptedAssets[0] ?? null
    });
    this.logger?.info?.({
      event: "paid_call_event",
      ...paidEventBase({
        ...baseEvent,
        receiptId: receipt.receipt_id,
        status: "verified"
      }),
      network: effectiveNetwork,
      asset: paymentAssetRaw ?? assetAddressForSymbol(acceptedAssets[0], effectiveNetwork) ?? acceptedAssets[0] ?? null
    });
    this.logger?.info?.({
      event: "payment_verified",
      operation,
      adapter_trace_id: adapterTraceId,
      payer: receipt.payer,
      subject_id: subjectId ?? null,
      receipt_id: receipt.receipt_id,
      facilitator_provider: this.config.x402FacilitatorProvider ?? "openfacilitator",
      network: effectiveNetwork,
      payTo: this.config.x402PayTo ?? null,
      price: this.config.x402Price ?? this.config.x402PriceUsd ?? this.config.x402PricePerUnitAtomic ?? null,
      asset: paymentAssetRaw ?? assetAddressForSymbol(acceptedAssets[0], effectiveNetwork) ?? acceptedAssets[0] ?? null
    });
    this.metrics?.inc?.("x402_billed_units_total", requiredUnits);
    this.metrics?.inc?.(`x402_billed_units_${operation}`, requiredUnits);

    return {
      billed_units: requiredUnits,
      payer: receipt.payer,
      payment_receipt_id: receipt.receipt_id,
      x402_receipt: {
        ...receipt,
        x402_verified: true,
        facilitator_provider: this.config.x402FacilitatorProvider ?? "openfacilitator",
        network: effectiveNetwork,
        payTo: this.config.x402PayTo ?? null,
        price: this.config.x402Price ?? this.config.x402PriceUsd ?? this.config.x402PricePerUnitAtomic ?? null,
        asset: paymentAssetRaw ?? assetAddressForSymbol(acceptedAssets[0], effectiveNetwork) ?? acceptedAssets[0] ?? null
      },
      spend_controls: await this.store.spendState(receipt.payer),
      verifier_reference: receipt.verifier_reference,
      proof_id: receipt.proof_id,
      session_id: receipt.session_id
    };
  }
}
