export type InstallScopedSecretStore = {
  readMarker: () => Promise<string | null>;
  clearSecret: () => Promise<void>;
  writeMarker: (value: string) => Promise<void>;
};

export async function enforceInstallScopedSecret(
  store: InstallScopedSecretStore,
  markerValue: string,
): Promise<boolean> {
  if ((await store.readMarker()) === markerValue) {
    return false;
  }

  await store.clearSecret();
  await store.writeMarker(markerValue);
  return true;
}
