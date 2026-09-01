import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { enforceInstallScopedSecret } from "./install-scoped-secret";
import type { DirectProviderSettings } from "./types";

const ENDPOINT_KEY = "@rolling-cores/direct-endpoint";
const MODEL_KEY = "@rolling-cores/direct-model";
const INSTALL_MARKER_KEY = "@rolling-cores/direct-key-install/1";
const INSTALL_MARKER_VALUE = "installed";
const API_KEY = "rolling-cores-direct-api-key";
const SECURE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let installInitialization: Promise<void> | null = null;

export async function loadDirectProviderSettings(): Promise<DirectProviderSettings> {
  await initializeDirectProviderStorage();
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
  const previous = await loadDirectProviderSettings();
  try {
    await writeApiKey(settings.apiKey);
    await AsyncStorage.multiSet([
      [ENDPOINT_KEY, settings.endpoint],
      [MODEL_KEY, settings.model],
    ]);
  } catch (caught) {
    const rollbackFailures: string[] = [];
    try {
      await AsyncStorage.multiSet([
        [ENDPOINT_KEY, previous.endpoint],
        [MODEL_KEY, previous.model],
      ]);
    } catch (rollback) {
      rollbackFailures.push(`metadata: ${(rollback as Error).message}`);
    }
    try {
      await writeApiKey(previous.apiKey);
    } catch (rollback) {
      rollbackFailures.push(`key: ${(rollback as Error).message}`);
    }
    if (rollbackFailures.length) {
      throw new Error(
        `Provider settings save failed: ${(caught as Error).message}. Rollback also failed (${rollbackFailures.join("; ")}).`,
      );
    }
    throw caught;
  }
}

function initializeDirectProviderStorage(): Promise<void> {
  if (!installInitialization) {
    installInitialization = enforceInstallScopedSecret(
      {
        readMarker: () => AsyncStorage.getItem(INSTALL_MARKER_KEY),
        clearSecret: () =>
          SecureStore.deleteItemAsync(API_KEY, SECURE_OPTIONS),
        writeMarker: (value) => AsyncStorage.setItem(INSTALL_MARKER_KEY, value),
      },
      INSTALL_MARKER_VALUE,
    )
      .then(() => undefined)
      .catch((caught: unknown) => {
        installInitialization = null;
        throw caught;
      });
  }
  return installInitialization;
}

async function writeApiKey(value: string): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(API_KEY, value, SECURE_OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(API_KEY, SECURE_OPTIONS);
  }
}

export const directKeyStorageDescription =
  "API key stored through Expo SecureStore for this installation and restricted to this unlocked device.";
