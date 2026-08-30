import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DirectProviderSettings } from "./types";

const ENDPOINT_KEY = "@rolling-cores/direct-endpoint";
const MODEL_KEY = "@rolling-cores/direct-model";
const API_KEY = "rolling-cores-direct-api-key";

export async function loadDirectProviderSettings(): Promise<DirectProviderSettings> {
  const [endpoint, model] = await Promise.all([
    AsyncStorage.getItem(ENDPOINT_KEY),
    AsyncStorage.getItem(MODEL_KEY),
  ]);
  return {
    endpoint: endpoint ?? "https://api.openai.com/v1",
    model: model ?? "gpt-5-mini",
    apiKey:
      typeof sessionStorage === "undefined"
        ? ""
        : sessionStorage.getItem(API_KEY) ?? "",
  };
}

export async function saveDirectProviderSettings(
  settings: DirectProviderSettings,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(ENDPOINT_KEY, settings.endpoint),
    AsyncStorage.setItem(MODEL_KEY, settings.model),
  ]);
  if (typeof sessionStorage !== "undefined") {
    if (settings.apiKey) sessionStorage.setItem(API_KEY, settings.apiKey);
    else sessionStorage.removeItem(API_KEY);
  }
}

export const directKeyStorageDescription =
  "API key kept only in this browser tab's session storage.";
