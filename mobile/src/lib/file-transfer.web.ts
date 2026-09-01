export async function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept =
      "application/json,application/vnd.rapterbox.rolling-core+json,.json,.rollingcore";
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        if (file.size > 16 * 1024 * 1024) {
          throw new Error("Selected file exceeds the 16 MiB import limit.");
        }
        resolve(await file.text());
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function exportJsonFile(name: string, raw: string): Promise<void> {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("Export filename is invalid.");
  }
  const url = URL.createObjectURL(
    new Blob([raw], {
      type: name.endsWith(".rollingcore")
        ? "application/vnd.rapterbox.rolling-core+json"
        : "application/json",
    }),
  );
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = name;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readSharedFileUrl(_url: string): Promise<string | null> {
  return null;
}
