import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { validateProviderId } from "./openai-provider-profile.mjs";

export const PROVIDER_KEYCHAIN_SERVICE = "com.rapterbox.rollingcores.openai-compatible";
const execFile = promisify(execFileCallback);

function envName(profileId) {
  const suffix = validateProviderId(profileId)
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, "_");
  return `RAPP_OPENAI_PROVIDER_SECRET_${suffix}`;
}

function validateSecret(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 16_384
    || value.includes("\u0000")
  ) {
    throw new TypeError("Provider credential is invalid.");
  }
  return value;
}

export class ProviderCredentialResolver {
  constructor({
    platform = process.platform,
    env = process.env,
    execFileImpl = execFile,
    service = PROVIDER_KEYCHAIN_SERVICE,
  } = {}) {
    this.platform = platform;
    this.env = env;
    this.execFileImpl = execFileImpl;
    this.service = service;
  }

  environmentVariable(profileId) {
    return envName(profileId);
  }

  environmentSecret(profileId) {
    const value = this.env[envName(profileId)];
    return value ? validateSecret(value) : null;
  }

  async get(profileId) {
    const id = validateProviderId(profileId);
    const override = this.environmentSecret(id);
    if (override !== null) return override;
    if (this.platform !== "darwin") {
      throw new Error(
        `Set ${envName(id)}; persistent provider credentials require macOS Keychain.`,
      );
    }
    try {
      const { stdout } = await this.execFileImpl("security", [
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        id,
        "-w",
      ], { encoding: "utf8", maxBuffer: 32_768 });
      return validateSecret(stdout.replace(/\r?\n$/u, ""));
    } catch {
      throw new Error(`No credential is stored for provider profile ${id}.`);
    }
  }

  async has(profileId) {
    try {
      await this.get(profileId);
      return true;
    } catch {
      return false;
    }
  }

  async set(profileId, secretValue) {
    const id = validateProviderId(profileId);
    const secret = validateSecret(secretValue);
    if (this.platform !== "darwin") {
      throw new Error(
        `Set ${envName(id)}; this platform does not support persistent provider storage.`,
      );
    }
    try {
      await this.execFileImpl("security", [
        "add-generic-password",
        "-U",
        "-s",
        this.service,
        "-a",
        id,
        "-w",
        secret,
      ], { encoding: "utf8", maxBuffer: 32_768 });
    } catch {
      throw new Error(`Could not store the credential for provider profile ${id}.`);
    }
  }

  async delete(profileId) {
    const id = validateProviderId(profileId);
    if (this.platform !== "darwin") return;
    try {
      await this.execFileImpl("security", [
        "delete-generic-password",
        "-s",
        this.service,
        "-a",
        id,
      ], { encoding: "utf8", maxBuffer: 32_768 });
    } catch (error) {
      if (error?.code === 44) return;
      throw new Error(`Could not delete the credential for provider profile ${id}.`);
    }
  }
}
