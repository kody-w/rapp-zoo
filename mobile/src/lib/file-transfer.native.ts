import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export async function pickJsonFile(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/json",
      "application/vnd.rapterbox.rolling-core+json",
      "public.data",
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0]!;
  try {
    return await readBoundedFile(asset.uri);
  } finally {
    await FileSystem.deleteAsync(asset.uri, { idempotent: true });
  }
}

export async function readSharedFileUrl(url: string): Promise<string | null> {
  if (!url.startsWith("file://") && !url.startsWith("content://")) return null;
  return readBoundedFile(url);
}

export async function exportJsonFile(name: string, raw: string): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("Cache directory is unavailable.");
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("Export filename is invalid.");
  }
  const url = `${FileSystem.cacheDirectory}${name}`;
  try {
    await FileSystem.writeAsStringAsync(url, raw, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("The system share sheet is unavailable.");
    }
    const capsule = name.endsWith(".rollingcore");
    await Sharing.shareAsync(url, {
      mimeType: capsule
        ? "application/vnd.rapterbox.rolling-core+json"
        : "application/json",
      UTI: capsule ? "com.rapterbox.rollingcore" : "public.json",
    });
  } finally {
    await FileSystem.deleteAsync(url, { idempotent: true });
  }
}

async function readBoundedFile(
  url: string,
): Promise<string> {
  const info = await FileSystem.getInfoAsync(url);
  if (!info.exists) throw new Error("Selected file is unavailable.");
  const size = info.size;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_IMPORT_BYTES
  ) {
    throw new Error("Selected file exceeds the 16 MiB import limit.");
  }
  return FileSystem.readAsStringAsync(url, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}
