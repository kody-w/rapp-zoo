import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  validateRegistryRecordRaw,
} from "./registry";
import type { RapterCreditRegistryRecord } from "./types";

const PREFIX = "@rolling-cores/credit-registry/";

export async function loadRegistryMirror(): Promise<
  Record<string, RapterCreditRegistryRecord>
> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
    key.startsWith(PREFIX),
  );
  const records: Record<string, RapterCreditRegistryRecord> = {};
  for (const [key, value] of await AsyncStorage.multiGet(keys)) {
    if (!value) continue;
    try {
      const stored = JSON.parse(value) as { raw: string; verifiedAt: string };
      records[key.slice(PREFIX.length)] = {
        ...validateRegistryRecordRaw(stored.raw),
        verifiedAt: stored.verifiedAt,
      };
    } catch {
      // Keep invalid mirror bytes untouched but do not display official status.
    }
  }
  return records;
}

export async function storeRegistryRecord(
  record: RapterCreditRegistryRecord,
): Promise<void> {
  const key = `${PREFIX}${record.creditId}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) {
    const stored = JSON.parse(existing) as { raw: string; verifiedAt: string };
    const current = validateRegistryRecordRaw(stored.raw);
    if (current.registrySequence > record.registrySequence) {
      throw new Error("Refusing stale registry status.");
    }
  }
  await AsyncStorage.setItem(
    key,
    JSON.stringify({ raw: record.raw, verifiedAt: record.verifiedAt }),
  );
}
