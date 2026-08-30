import type { RapterCreditBinding } from "./types";

export function formatSats(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Satoshi value must be a non-negative safe integer.");
  }
  return `${value.toLocaleString("en-US")} sats`;
}

export function formatBtc(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Satoshi value must be a non-negative safe integer.");
  }
  return `${(value / 100_000_000).toFixed(8)} BTC`;
}

export function formatUsdCents(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("USD cent value must be a non-negative safe integer.");
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

export function fiatCentsForSats(
  priceSats: number,
  btcUsdCentsPerBtc: number,
): number {
  if (
    !Number.isSafeInteger(priceSats) ||
    priceSats < 0 ||
    !Number.isSafeInteger(btcUsdCentsPerBtc) ||
    btcUsdCentsPerBtc < 1
  ) {
    throw new Error("BTC conversion values must be non-negative safe integers.");
  }
  const value =
    (BigInt(priceSats) * BigInt(btcUsdCentsPerBtc) + 50_000_000n) /
    100_000_000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("BTC conversion exceeds the safe integer range.");
  }
  return Number(value);
}

export function uniquenessLabel(credit: RapterCreditBinding): string {
  return credit.uniqueness.kind === "bitcoin-utxo"
    ? `${credit.uniqueness.txid}:${credit.uniqueness.vout}`
    : `${credit.uniqueness.ledgerId} #${credit.uniqueness.sequence}`;
}
