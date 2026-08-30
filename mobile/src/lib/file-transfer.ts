export async function pickJsonFile(): Promise<string | null> {
  throw new Error("A platform document picker implementation is unavailable.");
}

export async function exportJsonFile(_name: string, _raw: string): Promise<void> {
  throw new Error("A platform export implementation is unavailable.");
}

export async function readSharedFileUrl(_url: string): Promise<string | null> {
  return null;
}
