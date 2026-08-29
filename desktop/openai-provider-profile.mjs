const AUTH_KINDS = new Set(["bearer", "api-key", "x-functions-key", "none"]);
const SAFE_HEADER_NAMES = new Set([
  "accept",
  "openai-organization",
  "openai-project",
]);
const PROFILE_KEYS = new Set([
  "id",
  "base_url",
  "model",
  "auth_kind",
  "azure",
  "headers",
  "timeouts",
]);
const AZURE_KEYS = new Set(["api_version", "deployment"]);
const TIMEOUT_KEYS = new Set(["connect_ms", "request_ms"]);
const METADATA_KEYS = new Set(["version", "active_profile_id", "profiles"]);

function plainObject(value, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${label} contains unknown key: ${key}.`);
  }
}

function boundedText(value, label, maximum, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalized;
}

function boundedInteger(value, label, minimum, maximum, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function validateAzure(value) {
  if (value === undefined) return undefined;
  plainObject(value, "azure");
  exactKeys(value, AZURE_KEYS, "azure");
  const result = {};
  if (value.api_version !== undefined) {
    result.api_version = boundedText(value.api_version, "azure.api_version", 64);
  }
  if (value.deployment !== undefined) {
    result.deployment = boundedText(value.deployment, "azure.deployment", 128);
  }
  if (Object.keys(result).length === 0) throw new TypeError("azure cannot be empty.");
  return result;
}

function validateHeaders(value) {
  if (value === undefined) return {};
  plainObject(value, "headers");
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.toLowerCase();
    if (!SAFE_HEADER_NAMES.has(name)) {
      throw new TypeError(`Header is not allowlisted: ${rawName}.`);
    }
    if (Object.hasOwn(headers, name)) {
      throw new TypeError(`Duplicate header: ${rawName}.`);
    }
    headers[name] = boundedText(rawValue, `headers.${rawName}`, 512);
  }
  return headers;
}

function validateTimeouts(value) {
  if (value === undefined) {
    return { connect_ms: 5_000, request_ms: 60_000 };
  }
  plainObject(value, "timeouts");
  exactKeys(value, TIMEOUT_KEYS, "timeouts");
  const connectMs = boundedInteger(
    value.connect_ms,
    "timeouts.connect_ms",
    250,
    30_000,
    5_000,
  );
  const requestMs = boundedInteger(
    value.request_ms,
    "timeouts.request_ms",
    1_000,
    120_000,
    60_000,
  );
  if (connectMs > requestMs) {
    throw new TypeError("timeouts.connect_ms cannot exceed timeouts.request_ms.");
  }
  return { connect_ms: connectMs, request_ms: requestMs };
}

export function validateProviderId(value) {
  const id = boundedText(value, "id", 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id)) {
    throw new TypeError("id must contain only letters, numbers, dot, underscore, or hyphen.");
  }
  return id;
}

export function validateProviderProfile(value) {
  plainObject(value, "profile");
  exactKeys(value, PROFILE_KEYS, "profile");
  const id = validateProviderId(value.id);
  const baseUrlValue = boundedText(value.base_url, "base_url", 2_048);
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new TypeError("base_url must be a valid URL.");
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new TypeError("base_url must use http or https.");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.hash || baseUrl.search) {
    throw new TypeError("base_url cannot contain credentials, query parameters, or a fragment.");
  }
  const authKind = boundedText(value.auth_kind, "auth_kind", 32);
  if (!AUTH_KINDS.has(authKind)) throw new TypeError("auth_kind is not supported.");
  const azure = validateAzure(value.azure);
  const normalizedBaseUrl = baseUrl.toString().replace(/\/+$/u, "");
  return Object.freeze({
    id,
    base_url: normalizedBaseUrl,
    model: boundedText(value.model, "model", 128),
    auth_kind: authKind,
    ...(azure ? { azure } : {}),
    headers: validateHeaders(value.headers),
    timeouts: validateTimeouts(value.timeouts),
  });
}

export function validateProviderMetadata(value) {
  plainObject(value, "provider metadata");
  exactKeys(value, METADATA_KEYS, "provider metadata");
  if (value.version !== 1) throw new TypeError("provider metadata version must be 1.");
  if (!Array.isArray(value.profiles)) throw new TypeError("profiles must be an array.");
  const profiles = value.profiles.map(validateProviderProfile);
  const ids = new Set();
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new TypeError(`Duplicate profile id: ${profile.id}.`);
    ids.add(profile.id);
  }
  const activeProfileId = value.active_profile_id === null
    ? null
    : validateProviderId(value.active_profile_id);
  if (activeProfileId !== null && !ids.has(activeProfileId)) {
    throw new TypeError("active_profile_id must name an existing profile.");
  }
  return {
    version: 1,
    active_profile_id: activeProfileId,
    profiles,
  };
}

export function emptyProviderMetadata() {
  return { version: 1, active_profile_id: null, profiles: [] };
}

function genericV1Url(profile, resource) {
  const url = new URL(profile.base_url);
  const basePath = url.pathname.replace(/\/+$/u, "");
  url.pathname = basePath.endsWith("/v1")
    ? `${basePath}/${resource}`
    : `${basePath}/v1/${resource}`;
  return url;
}

export function providerEndpoint(profileValue, resource) {
  const profile = validateProviderProfile(profileValue);
  if (!["models", "chat/completions"].includes(resource)) {
    throw new TypeError("Unsupported OpenAI-compatible resource.");
  }
  if (profile.azure?.deployment && resource === "chat/completions") {
    if (!profile.azure.api_version) {
      throw new TypeError("azure.api_version is required with azure.deployment.");
    }
    const url = new URL(profile.base_url);
    url.pathname = [
      url.pathname.replace(/\/+$/u, ""),
      "openai/deployments",
      encodeURIComponent(profile.azure.deployment),
      "chat/completions",
    ].filter(Boolean).join("/");
    if (!url.pathname.startsWith("/")) url.pathname = `/${url.pathname}`;
    url.searchParams.set("api-version", profile.azure.api_version);
    return url.toString();
  }
  if (profile.azure?.api_version && resource === "models") {
    const url = new URL(profile.base_url);
    const basePath = url.pathname.replace(/\/+$/u, "");
    url.pathname = `${basePath}/openai/models`;
    url.searchParams.set("api-version", profile.azure.api_version);
    return url.toString();
  }
  return genericV1Url(profile, resource).toString();
}

export const PROVIDER_AUTH_KINDS = Object.freeze([...AUTH_KINDS]);
export const PROVIDER_SAFE_HEADERS = Object.freeze([...SAFE_HEADER_NAMES]);
