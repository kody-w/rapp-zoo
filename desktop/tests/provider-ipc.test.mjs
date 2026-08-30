import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const main = readFileSync(path.resolve(here, "../main.mjs"), "utf8");
const preload = readFileSync(path.resolve(here, "../preload.cjs"), "utf8");

test("provider IPC is fixed and protected by the trusted local origin check", () => {
  for (const channel of [
    "providers:list",
    "providers:status",
    "providers:save",
    "providers:delete",
    "providers:test",
    "providers:set-active",
    "breathing:status",
    "breathing:start",
    "breathing:pause",
  ]) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    assert.match(
      main,
      new RegExp(
        `ipcMain\\.handle\\("${escaped}", (?:async )?\\(event[\\s\\S]{0,140}trusted\\(event\\)`,
      ),
    );
  }
  assert.match(main, /url\.hostname !== "127\.0\.0\.1"/);
  assert.match(main, /url\.port !== "7070"/);
  assert.match(preload, /listProviderProfiles: invoke\("providers:list"\)/);
  assert.match(preload, /providerStatus: invoke\("providers:status"\)/);
  assert.match(preload, /saveProviderProfile: invoke\("providers:save"\)/);
  assert.match(preload, /deleteProviderProfile: invoke\("providers:delete"\)/);
  assert.match(preload, /testProviderProfile: invoke\("providers:test"\)/);
  assert.match(preload, /setActiveProviderProfile: invoke\("providers:set-active"\)/);
  assert.match(preload, /breathingStatus: invoke\("breathing:status"\)/);
  assert.match(preload, /startBreathing: invoke\("breathing:start"\)/);
  assert.match(preload, /pauseBreathing: invoke\("breathing:pause"\)/);
  assert.match(preload, /onBreathingState/);
});
