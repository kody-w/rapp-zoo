import type { CapsuleLibraryEntry, ValidatedCapsule } from "./types";

export async function loadCapsuleLibrary(): Promise<CapsuleLibraryEntry[]> {
  return [];
}

export async function storeCapsule(
  _capsule: ValidatedCapsule,
): Promise<void> {
  throw new Error("Rolling Core Capsule storage is unavailable.");
}
