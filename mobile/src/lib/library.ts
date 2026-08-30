import AsyncStorage from "@react-native-async-storage/async-storage";
import { canonicalize, strictParse } from "./strict-json";
import { validateHoloRaw, verifySourceFrame } from "./holo";
import type { JsonObject, LibraryEntry, ValidatedHolo } from "./types";

const HOST_KEY = "@rolling-cores/base-url";
const INDEX_KEY = "@rolling-cores/library-index";
const FRAME_PREFIX = "@rolling-cores/frame/";
const SOURCE_PREFIX = "@rolling-cores/source/";
const LEGACY_HOST_KEY = "@holo-zoo/base-url";
const LEGACY_INDEX_KEY = "@holo-zoo/library-index";
const LEGACY_FRAME_PREFIX = "@holo-zoo/frame/";
const DEFAULT_HOST = "http://127.0.0.1:5000";

type IndexEntry = { id: string; importedAt: string };

export async function loadBaseUrl(): Promise<string> {
  const current = await AsyncStorage.getItem(HOST_KEY);
  if (current) return current;
  const legacy = await AsyncStorage.getItem(LEGACY_HOST_KEY);
  if (legacy) {
    await AsyncStorage.setItem(HOST_KEY, legacy);
    return legacy;
  }
  return DEFAULT_HOST;
}

export async function saveBaseUrl(value: string): Promise<void> {
  await AsyncStorage.setItem(HOST_KEY, value);
}

export async function loadLibrary(): Promise<LibraryEntry[]> {
  await migrateLegacyLibrary();
  const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
  const index: IndexEntry[] = rawIndex ? JSON.parse(rawIndex) : [];
  const entries: LibraryEntry[] = [];
  for (const item of index) {
    const raw = await AsyncStorage.getItem(`${FRAME_PREFIX}${item.id}`);
    if (!raw) continue;
    try {
      const holo = validateHoloRaw(raw);
      const sourceRaw = await AsyncStorage.getItem(`${SOURCE_PREFIX}${item.id}`);
      let source: JsonObject | null = null;
      if (sourceRaw) {
        try {
          source = verifySourceFrame(strictParse(sourceRaw), holo);
        } catch {
          source = null;
        }
      }
      entries.push({
        id: item.id,
        importedAt: item.importedAt,
        holo,
        source,
      });
    } catch {
      // Refuse corrupt entries without rewriting or deleting their bytes.
    }

  }
  return entries.sort(
    (left, right) =>
      right.holo.holoSequence - left.holo.holoSequence ||
      right.importedAt.localeCompare(left.importedAt),
  );
}

async function migrateLegacyLibrary(): Promise<void> {
  const rawLegacyIndex = await AsyncStorage.getItem(LEGACY_INDEX_KEY);
  if (!rawLegacyIndex) return;
  const legacyIndex: IndexEntry[] = JSON.parse(rawLegacyIndex);
  const rawCurrentIndex = await AsyncStorage.getItem(INDEX_KEY);
  const currentIndex: IndexEntry[] = rawCurrentIndex
    ? JSON.parse(rawCurrentIndex)
    : [];
  const known = new Set(currentIndex.map((entry) => entry.id));
  const additions: IndexEntry[] = [];
  const writes: [string, string][] = [];
  for (const entry of legacyIndex) {
    if (known.has(entry.id)) continue;
    const raw = await AsyncStorage.getItem(`${LEGACY_FRAME_PREFIX}${entry.id}`);
    if (!raw) continue;
    try {
      const holo = validateHoloRaw(raw);
      writes.push([`${FRAME_PREFIX}${holo.id}`, raw]);
      additions.push({ id: holo.id, importedAt: entry.importedAt });
      known.add(holo.id);
    } catch {
      // Preserve invalid legacy bytes in place without importing or repairing.
    }
  }
  if (additions.length > 0) {
    writes.push([INDEX_KEY, JSON.stringify([...currentIndex, ...additions])]);
    await AsyncStorage.multiSet(writes);
  }
}

export async function storeHolo(
  holo: ValidatedHolo,
  importedAt = new Date().toISOString(),
  source: JsonObject | null = null,
): Promise<void> {
  const key = `${FRAME_PREFIX}${holo.id}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing !== null) {
    const existingValue = validateHoloRaw(existing);
    if (canonicalize(existingValue.root) !== canonicalize(holo.root)) {
      throw new Error("An immutable library ID already exists with different content.");
    }
    if (source) {
      const verified = verifySourceFrame(source, holo);
      await AsyncStorage.setItem(
        `${SOURCE_PREFIX}${holo.id}`,
        canonicalize(verified),
      );
    }
    return;
  }
  const rawIndex = await AsyncStorage.getItem(INDEX_KEY);
  const index: IndexEntry[] = rawIndex ? JSON.parse(rawIndex) : [];
  const writes: [string, string][] = [
    [key, holo.raw],
    [INDEX_KEY, JSON.stringify([...index, { id: holo.id, importedAt }])],
  ];
  if (source) {
    const verified = verifySourceFrame(source, holo);
    writes.push([`${SOURCE_PREFIX}${holo.id}`, canonicalize(verified)]);
  }
  await AsyncStorage.multiSet(writes);
}

export async function importHoloRaw(raw: string): Promise<ValidatedHolo> {
  const holo = validateHoloRaw(raw);
  await storeHolo(holo);
  return holo;
}
