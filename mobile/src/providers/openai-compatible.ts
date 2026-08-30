import type {
  DirectProviderSettings,
  OpenAICompatibleProvider,
  OpenAICompatibleRequest,
  OpenAICompatibleResponse,
} from "./types";

type FetchLike = typeof fetch;

export function createDirectProvider(
  settings: DirectProviderSettings,
  fetchImpl: FetchLike = fetch,
): OpenAICompatibleProvider {
  if (!settings.apiKey.trim()) {
    throw new Error("Direct mode requires the user's OpenAI-compatible API key.");
  }
  return createProvider(
    "direct",
    settings.endpoint,
    settings.model,
    { Authorization: `Bearer ${settings.apiKey}` },
    true,
    fetchImpl,
  );
}

export function createWildProvider(
  options: { endpoint: string; model: string; sessionToken?: string },
  fetchImpl: FetchLike = fetch,
): OpenAICompatibleProvider {
  const headers = options.sessionToken
    ? { Authorization: `Bearer ${options.sessionToken}` }
    : {};
  return createProvider(
    "wild",
    options.endpoint,
    options.model,
    headers,
    Boolean(options.sessionToken),
    fetchImpl,
  );
}

function createProvider(
  mode: "direct" | "wild",
  endpoint: string,
  model: string,
  extraHeaders: Record<string, string>,
  authenticated: boolean,
  fetchImpl: FetchLike,
): OpenAICompatibleProvider {
  const normalizedEndpoint = normalizeOpenAIEndpoint(endpoint, authenticated);
  if (!model.trim()) {
    throw new Error("An OpenAI-compatible model identifier is required.");
  }
  return {
    mode,
    endpoint: normalizedEndpoint,
    model: model.trim(),
    async complete(request: OpenAICompatibleRequest, options) {
      const init: RequestInit = {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify({
          ...request,
          model: request.model || model.trim(),
        }),
      };
      if (options?.signal) init.signal = options.signal;
      const response = await fetchImpl(
        `${normalizedEndpoint}/chat/completions`,
        init,
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `${mode === "direct" ? "Direct provider" : "Wild Brainstem"} returned HTTP ${response.status}: ${body.slice(0, 240)}`,
        );
      }
      return (await response.json()) as OpenAICompatibleResponse;
    },
  };
}

export async function testDirectProvider(
  settings: DirectProviderSettings,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const provider = createDirectProvider(settings, fetchImpl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(`${provider.endpoint}/models`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Breath key was rejected or revoked."
          : `Provider key test returned HTTP ${response.status}.`,
      );
    }
    const value = (await response.json()) as { data?: { id?: unknown }[] };
    if (
      !Array.isArray(value.data) ||
      !value.data.some((item) => item?.id === provider.model)
    ) {
      throw new Error(
        `Provider key worked, but model ${provider.model} was not available.`,
      );
    }
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Provider key test failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeOpenAIEndpoint(
  value: string,
  authenticated = true,
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid OpenAI-compatible http or https endpoint.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("OpenAI-compatible endpoint must use http or https.");
  }
  if (
    url.protocol === "http:" &&
    (authenticated || !isLoopbackHostname(url.hostname))
  ) {
    throw new Error(
      "Provider credentials require HTTPS; HTTP is allowed only for unauthenticated loopback providers.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Provider endpoint cannot contain credentials, query, or fragment.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

export function configuredWildBrainstem(): {
  endpoint: string | null;
  model: string;
  error: string | null;
} {
  const endpoint = process.env.EXPO_PUBLIC_RAPTERBOX_WILD_BRAINSTEM_URL?.trim();
  const model =
    process.env.EXPO_PUBLIC_RAPTERBOX_WILD_MODEL?.trim() ||
    "rapterbox-managed";
  if (!endpoint) {
    return {
      endpoint: null,
      model,
      error:
        "EXPO_PUBLIC_RAPTERBOX_WILD_BRAINSTEM_URL is absent. Wild Brainstem routing is unavailable.",
    };
  }
  try {
    return { endpoint: normalizeOpenAIEndpoint(endpoint), model, error: null };
  } catch (caught) {
    return { endpoint: null, model, error: (caught as Error).message };
  }
}
