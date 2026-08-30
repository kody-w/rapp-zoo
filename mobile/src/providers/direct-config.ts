import type { DirectProviderSettings } from "./types";

export async function loadDirectProviderSettings(): Promise<DirectProviderSettings> {
  return {
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    apiKey: "",
  };
}

export async function saveDirectProviderSettings(
  _settings: DirectProviderSettings,
): Promise<void> {
  throw new Error("Secure Direct provider storage is unavailable.");
}

export const directKeyStorageDescription =
  "Secure API key storage is unavailable on this platform.";
