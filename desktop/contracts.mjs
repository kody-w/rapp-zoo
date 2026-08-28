export const DESKTOP_SCHEMA = "rapp-zoo-desktop/1.0";
export const COPILOT_REQUEST_SCHEMA = "rapp-zoo-copilot-request/1.0";
export const MAX_PROMPT_CHARS = 12_000;
export const MAX_CONTEXT_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export function validatePrompt(value) {
  if (typeof value !== "string") {
    throw new Error("Copilot prompt must be text.");
  }
  const prompt = value.normalize("NFC").trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Copilot prompt must be 1-${MAX_PROMPT_CHARS} characters.`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt)) {
    throw new Error("Copilot prompt contains unsupported control characters.");
  }
  return prompt;
}

export function validateContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Intelligence context must be an object.");
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_CONTEXT_BYTES) {
    throw new Error("Intelligence context exceeds its byte limit.");
  }
  return value;
}

export function desktopState({ zoo, copilot }) {
  return {
    schema: DESKTOP_SCHEMA,
    zoo,
    copilot,
    mobile: {
      installable_pwa: true,
      intelligence_location: "desktop-host",
    },
  };
}
