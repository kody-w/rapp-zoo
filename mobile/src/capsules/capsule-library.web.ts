import AsyncStorage from "@react-native-async-storage/async-storage";
import { canonicalize } from "@/lib/strict-json";
import {
  assertOneToOneCreditBindings,
  validateCapsuleRaw,
} from "./capsule";
import type { CapsuleLibraryEntry, ValidatedCapsule } from "./types";

const INDEX_KEY = "@rolling-cores/capsule-index";
const PREFIX = "@rolling-cores/capsule/";

export async function loadCapsuleLibrary(): Promise<CapsuleLibraryEntry[]> {
  const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
  const index: { id: string; importedAt: string }[] = rawIndex
    ? JSON.parse(rawIndex)
    : [];
  const entries: CapsuleLibraryEntry[] = [];
  for (const item of index) {
    const raw = await AsyncStorage.getItem(`${PREFIX}${item.id}`);
    if (!raw) continue;
    try {
      entries.push({
        id: item.id,
        importedAt: item.importedAt,
        capsule: validateCapsuleRaw(raw),
      });
    } catch {
      // Preserve refused bytes without silently repairing them.
    }
  }
  assertOneToOneCreditBindings(entries);
  return entries.sort((left, right) =>
    right.importedAt.localeCompare(left.importedAt),
  );
}

export async function storeCapsule(
  capsule: ValidatedCapsule,
): Promise<void> {
  const key = `${PREFIX}${capsule.capsuleId}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) {
    const current = validateCapsuleRaw(existing);
    if (canonicalize(current.root) !== canonicalize(capsule.root)) {
      throw new Error(
        "An immutable capsule ID already exists with different content.",
      );
    }
    return;
  }
  const current = await loadCapsuleLibrary();
  assertOneToOneCreditBindings([
    ...current,
    { id: capsule.capsuleId, importedAt: new Date().toISOString(), capsule },
  ]);
  const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
  const index: { id: string; importedAt: string }[] = rawIndex
    ? JSON.parse(rawIndex)
    : [];
  await AsyncStorage.multiSet([
    [key, capsule.raw],
    [
      INDEX_KEY,
      JSON.stringify([
        ...index,
        { id: capsule.capsuleId, importedAt: new Date().toISOString() },
      ]),
    ],
  ]);
}
