import "dotenv/config";
import { x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const targetUrl =
  process.env.TARGET_URL ||
  "https://infopunks-x402-adapter.onrender.com/trust-score";

const fallbackPaymentJson = process.env.FACILITATOR_PAYMENT_JSON ?? null;
const privateKey = process.env.EVM_PRIVATE_KEY;
if (!privateKey || privateKey === "0xyour_private_key_here") {
  throw new Error(
    "Set EVM_PRIVATE_KEY in .env to a real test wallet private key before running."
  );
}

const paymentClient = new x402Client();
const paymentHttpClient = new x402HTTPClient(paymentClient);
const signer = privateKeyToAccount(privateKey);
registerExactEvmScheme(paymentClient, { signer });

async function main() {
  const requestBody = {
    entity_id: "agent_001",
  };

  const initialRes = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (initialRes.status !== 402) {
    const text = await initialRes.text();
    console.log("Status:", initialRes.status);
    console.log("Headers:", Object.fromEntries(initialRes.headers.entries()));
    console.log("Body:", text);
    return;
  }

  let paymentRequired = null;
  try {
    const responseText = await initialRes.text();
    let parsedBody;
    if (responseText) {
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        parsedBody = undefined;
      }
    }
    paymentRequired = paymentHttpClient.getPaymentRequiredResponse(
      (name) => initialRes.headers.get(name),
      parsedBody
    );
  } catch {
    paymentRequired = null;
  }

  if (paymentRequired) {
    const paymentPayload = await paymentClient.createPaymentPayload(paymentRequired);
    const paymentHeaders = paymentHttpClient.encodePaymentSignatureHeader(paymentPayload);

    const paidRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...paymentHeaders,
      },
      body: JSON.stringify(requestBody),
    });
    const paidText = await paidRes.text();
    console.log("Status:", paidRes.status);
    console.log("Headers:", Object.fromEntries(paidRes.headers.entries()));
    console.log("Body:", paidText);
    return;
  }

  if (fallbackPaymentJson) {
    let fallbackPayment;
    try {
      fallbackPayment = JSON.parse(fallbackPaymentJson);
    } catch (error) {
      throw new Error(
        `FACILITATOR_PAYMENT_JSON is not valid JSON: ${error?.message ?? "unknown error"}`
      );
    }

    const compatRes = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...requestBody,
        payment: fallbackPayment,
      }),
    });

    const compatText = await compatRes.text();
    console.log("Status:", compatRes.status);
    console.log("Headers:", Object.fromEntries(compatRes.headers.entries()));
    console.log("Body:", compatText);
    return;
  }

  console.error("Received HTTP 402 but no PAYMENT-REQUIRED challenge.");
  console.error("This endpoint is x402-style metadata only, not full x402 HTTP challenge yet.");
  console.error("Set FACILITATOR_PAYMENT_JSON in .env for compatibility testing.");
  console.error("Headers from initial 402:");
  console.error(Object.fromEntries(initialRes.headers.entries()));
  process.exit(2);
}

main().catch((err) => {
  console.error("x402 buyer test failed:");
  console.error(err);
  process.exit(1);
});
