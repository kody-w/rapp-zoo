import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { DirectProviderSettings } from "./types";

const ENDPOINT_KEY = "@rolling-cores/direct-endpoint";
const MODEL_KEY = "@rolling-cores/direct-model";
const API_KEY = "rolling-cores-direct-api-key";
const SECURE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function loadDirectProviderSettings(): Promise<DirectProviderSettings> {
  const [endpoint, model, apiKey] = await Promise.all([
    AsyncStorage.getItem(ENDPOINT_KEY),
    AsyncStorage.getItem(MODEL_KEY),
    SecureStore.getItemAsync(API_KEY, SECURE_OPTIONS),
  ]);
  return {
    endpoint: endpoint ?? "https://api.openai.com/v1",
    model: model ?? "gpt-5-mini",
    apiKey: apiKey ?? "",
  };
}

export async function saveDirectProviderSettings(
  settings: DirectProviderSettings,
): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(ENDPOINT_KEY, settings.endpoint),
    AsyncStorage.setItem(MODEL_KEY, settings.model),
    settings.apiKey
      ? SecureStore.setItemAsync(API_KEY, settings.apiKey, SECURE_OPTIONS)
      : SecureStore.deleteItemAsync(API_KEY, SECURE_OPTIONS),
  ]);
}

export const directKeyStorageDescription =
  "API key stored through Expo SecureStore and restricted to this unlocked device.";
