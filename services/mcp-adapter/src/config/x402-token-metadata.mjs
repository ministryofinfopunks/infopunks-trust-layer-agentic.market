function normalizeNetwork(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

const TOKENS_BY_NETWORK = {
  "eip155:84532": {
    USDC: {
      symbol: "USDC",
      address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      eip712Name: "USDC",
      eip712Version: "2"
    }
  },
  "eip155:8453": {
    USDC: {
      symbol: "USDC",
      address: "0x833589fCD6eDb6E08f4c7c32D4f71b54bdA02913",
      eip712Name: "USDC",
      eip712Version: "2"
    }
  }
};

function tokenEntries(network) {
  const key = normalizeNetwork(network);
  return Object.values(TOKENS_BY_NETWORK[key] ?? {});
}

export function canonicalAddressForSymbol(network, symbol) {
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
  return TOKENS_BY_NETWORK[normalizedNetwork]?.[normalizedSymbol]?.address ?? null;
}

export function resolveExactEvmTokenMetadata({
  network,
  assetAddress,
  fallbackName = null,
  fallbackVersion = null
}) {
  const normalizedAddress = normalizeAddress(assetAddress);
  const canonical = tokenEntries(network).find((entry) => normalizeAddress(entry.address) === normalizedAddress);

  if (canonical) {
    return {
      symbol: canonical.symbol,
      name: canonical.eip712Name,
      version: canonical.eip712Version
    };
  }

  return {
    symbol: null,
    name: fallbackName,
    version: fallbackVersion
  };
}

