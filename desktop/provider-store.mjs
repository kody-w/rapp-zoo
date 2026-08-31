import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  emptyProviderMetadata,
  validateProviderId,
  validateProviderMetadata,
  validateProviderProfile,
} from "./openai-provider-profile.mjs";
import { ProviderCredentialResolver } from "./provider-credentials.mjs";

export const DEFAULT_PROVIDER_CONFIG = path.join(
  homedir(),
  ".rapp",
  "config",
  "openai-providers.json",
);

function writeMetadata(configPath, value) {
  const metadata = validateProviderMetadata(value);
  const directory = path.dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "w",
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, configPath);
    chmodSync(configPath, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return metadata;
}

function exactRequestKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label} contains unknown key: ${key}.`);
  }
}

export class ProviderStore {
  constructor({
    configPath = DEFAULT_PROVIDER_CONFIG,
    credentials = new ProviderCredentialResolver(),
  } = {}) {
    this.configPath = configPath;
    this.credentials = credentials;
  }

  read() {
    if (!existsSync(this.configPath)) return emptyProviderMetadata();
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.configPath, "utf8"));
    } catch {
      throw new Error("OpenAI provider metadata is unreadable.");
    }
    chmodSync(this.configPath, 0o600);
    return validateProviderMetadata(parsed);
  }

  write(value) {
    return writeMetadata(this.configPath, value);
  }

  async list() {
    const metadata = this.read();
    const profiles = await Promise.all(metadata.profiles.map(async (profile) => ({
      ...profile,
      credential_available: (
        profile.auth_kind === "none" || await this.credentials.has(profile.id)
      ),
    })));
    return {
      version: metadata.version,
      active_profile_id: metadata.active_profile_id,
      profiles,
    };
  }

  get(profileId) {
    const id = validateProviderId(profileId);
    const profile = this.read().profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error(`Unknown provider profile: ${id}.`);
    return profile;
  }

  active() {
    const metadata = this.read();
    if (!metadata.active_profile_id) throw new Error("No provider profile is active.");
    return metadata.profiles.find((profile) => profile.id === metadata.active_profile_id);
  }

  async save(request) {
    exactRequestKeys(request, ["profile", "secret"], "save request");
    const profile = validateProviderProfile(request.profile);
    const metadataExisted = existsSync(this.configPath);
    const previousMetadata = this.read();
    const metadata = structuredClone(previousMetadata);
    const credential = await this.#credentialSnapshot(profile.id);
    let credentialChanged = false;
    if (profile.auth_kind === "none") {
      if (request.secret !== undefined && request.secret !== null && request.secret !== "") {
        throw new TypeError("auth_kind none cannot store a credential.");
      }
      await this.credentials.delete(profile.id);
      credentialChanged = credential.exists;
    } else if (request.secret !== undefined && request.secret !== null && request.secret !== "") {
      await this.credentials.set(profile.id, request.secret);
      credentialChanged = !credential.exists || credential.secret !== request.secret;
    } else if (!await this.credentials.has(profile.id)) {
      throw new Error(`A credential is required for provider profile ${profile.id}.`);
    }
    const index = metadata.profiles.findIndex((candidate) => candidate.id === profile.id);
    if (index === -1) metadata.profiles.push(profile);
    else metadata.profiles[index] = profile;
    if (metadata.active_profile_id === null) metadata.active_profile_id = profile.id;
    try {
      this.write(metadata);
    } catch (writeError) {
      await this.#rollback(
        profile.id,
        credential,
        credentialChanged,
        metadataExisted,
        previousMetadata,
        writeError,
      );
    }
    return this.list();
  }

  async delete(request) {
    exactRequestKeys(request, ["id"], "delete request");
    const id = validateProviderId(request.id);
    const previousMetadata = this.read();
    const metadata = structuredClone(previousMetadata);
    if (!metadata.profiles.some((profile) => profile.id === id)) {
      throw new Error(`Unknown provider profile: ${id}.`);
    }
    const metadataExisted = existsSync(this.configPath);
    const credential = await this.#credentialSnapshot(id);
    await this.credentials.delete(id);
    metadata.profiles = metadata.profiles.filter((profile) => profile.id !== id);
    if (metadata.active_profile_id === id) metadata.active_profile_id = null;
    try {
      this.write(metadata);
    } catch (writeError) {
      await this.#rollback(
        id,
        credential,
        credential.exists,
        metadataExisted,
        previousMetadata,
        writeError,
      );
    }
    return this.list();
  }

  async setActive(request) {
    exactRequestKeys(request, ["id"], "set-active request");
    const id = validateProviderId(request.id);
    const metadata = this.read();
    const profile = metadata.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error(`Unknown provider profile: ${id}.`);
    if (profile.auth_kind !== "none" && !await this.credentials.has(id)) {
      throw new Error(`No credential is stored for provider profile ${id}.`);
    }
    metadata.active_profile_id = id;
    this.write(metadata);
    return this.list();
  }

  async #credentialSnapshot(profileId) {
    if (!await this.credentials.has(profileId)) {
      return { exists: false, secret: null };
    }
    return { exists: true, secret: await this.credentials.get(profileId) };
  }

  async #rollback(
    profileId,
    credential,
    credentialChanged,
    metadataExisted,
    previousMetadata,
    writeError,
  ) {
    const rollbackErrors = [];
    if (credentialChanged) {
      try {
        if (credential.exists) await this.credentials.set(profileId, credential.secret);
        else await this.credentials.delete(profileId);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    try {
      if (metadataExisted) writeMetadata(this.configPath, previousMetadata);
      else rmSync(this.configPath, { force: true });
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [writeError, ...rollbackErrors],
        "Provider metadata persistence failed and rollback was incomplete.",
      );
    }
    throw writeError;
  }
}
