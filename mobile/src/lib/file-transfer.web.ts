export async function pickJsonFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      try {
        resolve(input.files?.[0] ? await input.files[0].text() : null);
      } catch (error) {
        reject(error);
      }
    };
    input.click();
  });
}

export async function exportJsonFile(name: string, raw: string): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([raw], {
      type: name.endsWith(".rollingcore")
        ? "application/vnd.rapterbox.rolling-core+json"
        : "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readSharedFileUrl(_url: string): Promise<string | null> {
  return null;
}
