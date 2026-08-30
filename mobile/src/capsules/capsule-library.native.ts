import * as FileSystem from "expo-file-system/legacy";
import { canonicalize } from "@/lib/strict-json";
import {
  assertOneToOneCreditBindings,
  validateCapsuleRaw,
} from "./capsule";
import type { CapsuleLibraryEntry, ValidatedCapsule } from "./types";

export async function loadCapsuleLibrary(): Promise<CapsuleLibraryEntry[]> {
  const directory = await ensureDirectory();
  const files = await FileSystem.readDirectoryAsync(directory);
  const entries: CapsuleLibraryEntry[] = [];
  for (const file of files.filter((name) => name.endsWith(".rollingcore.json"))) {
    const uri = `${directory}${file}`;
    try {
      const raw = await FileSystem.readAsStringAsync(uri);
      const info = await FileSystem.getInfoAsync(uri);
      const capsule = validateCapsuleRaw(raw);
      entries.push({
        id: capsule.capsuleId,
        importedAt:
          info.exists && info.modificationTime
            ? new Date(info.modificationTime * 1000).toISOString()
            : new Date(0).toISOString(),
        capsule,
      });
    } catch {
      // Preserve refused files without rewriting or deleting them.
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
  const directory = await ensureDirectory();
  const uri = `${directory}${capsule.capsuleId}.rollingcore.json`;
  const existing = await FileSystem.getInfoAsync(uri);
  if (existing.exists) {
    const raw = await FileSystem.readAsStringAsync(uri);
    const current = validateCapsuleRaw(raw);
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
  await FileSystem.writeAsStringAsync(uri, capsule.raw, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function ensureDirectory(): Promise<string> {
  if (!FileSystem.documentDirectory) {
    throw new Error("Application document storage is unavailable.");
  }
  const directory = `${FileSystem.documentDirectory}RollingCoreCapsules/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}
