export type CurrentBtcQuote = {
  btcUsdCentsPerBtc: number;
  asOfUtc: string;
  source: string;
};

export async function fetchCurrentBtcQuote(): Promise<CurrentBtcQuote | null> {
  const configured = process.env.EXPO_PUBLIC_RAPTERBOX_BTC_SPOT_URL?.trim();
  if (!configured) return null;
  const url = normalizeEndpoint(configured);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  return parseCurrentBtcQuotePayload(await response.json());
}

export function parseCurrentBtcQuotePayload(
  value: unknown,
): CurrentBtcQuote | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).some(
      (key) => !["btc_usd_cents_per_btc", "as_of_utc", "source"].includes(key),
    )
  ) {
    return null;
  }
  if (
    typeof object.btc_usd_cents_per_btc !== "number" ||
    !Number.isSafeInteger(object.btc_usd_cents_per_btc) ||
    object.btc_usd_cents_per_btc < 1 ||
    typeof object.as_of_utc !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(object.as_of_utc) ||
    typeof object.source !== "string" ||
    object.source.length < 1 ||
    object.source.length > 128
  ) {
    return null;
  }
  return {
    btcUsdCentsPerBtc: object.btc_usd_cents_per_btc,
    asOfUtc: object.as_of_utc,
    source: object.source,
  };
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Current BTC quote URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Current BTC quote URL must use HTTPS and contain no credentials.",
    );
  }
  return url.toString();
}
