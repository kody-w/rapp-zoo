import {
  providerEndpoint,
  validateProviderId,
} from "./openai-provider-profile.mjs";

const CHAT_KEYS = new Set([
  "messages",
  "max_tokens",
  "temperature",
  "top_p",
  "user",
]);
const MESSAGE_KEYS = new Set(["role", "content"]);
const ROLES = new Set(["developer", "system", "user", "assistant"]);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown key: ${key}.`);
  }
}

function validateChatRequest(value) {
  exactKeys(value, CHAT_KEYS, "chat request");
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 64) {
    throw new TypeError("messages must contain 1 to 64 items.");
  }
  let totalCharacters = 0;
  const messages = value.messages.map((message, index) => {
    exactKeys(message, MESSAGE_KEYS, `messages[${index}]`);
    if (!ROLES.has(message.role)) throw new TypeError(`messages[${index}].role is invalid.`);
    if (typeof message.content !== "string" || message.content.length < 1) {
      throw new TypeError(`messages[${index}].content must be a non-empty string.`);
    }
    totalCharacters += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (totalCharacters > 128_000) throw new TypeError("Message content is too large.");
  const result = { messages };
  if (value.max_tokens !== undefined) {
    if (!Number.isSafeInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 8_192) {
      throw new TypeError("max_tokens must be an integer from 1 to 8192.");
    }
    result.max_tokens = value.max_tokens;
  }
  for (const key of ["temperature", "top_p"]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
        throw new TypeError(`${key} must be a finite number.`);
      }
      result[key] = value[key];
    }
  }
  if (value.user !== undefined) {
    if (typeof value.user !== "string" || value.user.length > 128) {
      throw new TypeError("user must be a string no longer than 128 characters.");
    }
    result.user = value.user;
  }
  return result;
}

async function responseJson(response) {
  const contentLength = Number.parseInt(response.headers?.get?.("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > 5_000_000) {
    throw new Error("Provider response exceeded the size limit.");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Provider returned invalid JSON.");
  }
}

export class OpenAICompatibleClient {
  constructor({ store, fetchImpl = globalThis.fetch } = {}) {
    if (!store) throw new TypeError("A provider store is required.");
    this.store = store;
    this.fetchImpl = fetchImpl;
  }

  async headers(profile, includeContentType = false) {
    const headers = { accept: "application/json", ...profile.headers };
    if (includeContentType) headers["content-type"] = "application/json";
    if (profile.auth_kind !== "none") {
      if (new URL(profile.base_url).protocol !== "https:") {
        throw new Error("Provider credentials require HTTPS.");
      }
      const secret = await this.store.credentials.get(profile.id);
      if (profile.auth_kind === "bearer") headers.authorization = `Bearer ${secret}`;
      if (profile.auth_kind === "api-key") headers["api-key"] = secret;
      if (profile.auth_kind === "x-functions-key") headers["x-functions-key"] = secret;
    }
    return headers;
  }

  async request(profile, resource, options, externalSignal = null) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), profile.timeouts.request_ms);
    try {
      return await this.fetchImpl(providerEndpoint(profile, resource), {
        ...options,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Provider request timed out.");
      throw new Error("Provider request failed.");
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", abort);
    }
  }

  async test(request) {
    exactKeys(request, new Set(["id"]), "test request");
    const profile = this.store.get(validateProviderId(request.id));
    const started = performance.now();
    const response = await this.request(profile, "models", {
      method: "GET",
      headers: await this.headers(profile),
    });
    const body = await responseJson(response);
    if (!response.ok) throw new Error(`Provider test returned HTTP ${response.status}.`);
    if (body?.object !== "list" || !Array.isArray(body.data)) {
      throw new Error("Provider returned an invalid models response.");
    }
    return {
      ok: true,
      status: response.status,
      profile_id: profile.id,
      model: profile.model,
      model_available: body.data.some((model) => model?.id === profile.model),
      model_count: body.data.length,
      latency_ms: Math.max(0, Math.round(performance.now() - started)),
    };
  }

  async chat(profileId, requestValue, { signal = null } = {}) {
    const profile = profileId ? this.store.get(profileId) : this.store.active();
    const request = validateChatRequest(requestValue);
    const response = await this.request(
      profile,
      "chat/completions",
      {
        method: "POST",
        headers: await this.headers(profile, true),
        body: JSON.stringify({ ...request, model: profile.model, stream: false }),
      },
      signal,
    );
    const body = await responseJson(response);
    if (!response.ok) throw new Error(`Provider chat returned HTTP ${response.status}.`);
    if (body?.object !== "chat.completion" || !Array.isArray(body.choices)) {
      throw new Error("Provider returned an invalid chat completion.");
    }
    return body;
  }
}
