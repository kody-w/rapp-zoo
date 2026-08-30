import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

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
  return FileSystem.readAsStringAsync(result.assets[0]!.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function readSharedFileUrl(url: string): Promise<string | null> {
  if (!url.startsWith("file://") && !url.startsWith("content://")) return null;
  return FileSystem.readAsStringAsync(url, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

export async function exportJsonFile(name: string, raw: string): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("Cache directory is unavailable.");
  const url = `${FileSystem.cacheDirectory}${name}`;
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
}
