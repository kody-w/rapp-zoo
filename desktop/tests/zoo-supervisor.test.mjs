import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ZooSupervisor,
  healthy,
  pipIn,
  pythonIn,
} from "../zoo-supervisor.mjs";

test("runtime paths stay inside the private venv", () => {
  const python = pythonIn("/tmp/runtime");
  const pip = pipIn("/tmp/runtime");
  assert.match(python, /runtime/);
  assert.match(pip, /runtime/);
});

test("health adoption is fail-closed", async () => {
  const response = (token = null) => ({
    ok: true,
    json: async () => ({
      name: "rapp-zoo",
      schema: "rapp-zoo-health/1.0",
      status: "ok",
    }),
    headers: new Headers(token ? { "x-rapp-zoo-desktop": token } : {}),
  });
  assert.equal(await healthy(async () => response()), true);
  assert.equal(await healthy(async () => response("secret"), "secret"), true);
  assert.equal(await healthy(async () => response(), "secret"), false);
  assert.equal(await healthy(async () => ({
    ...response(),
    json: async () => ({ name: "imposter" }),
  })), false);
  assert.equal(await healthy(async () => ({ ok: false })), false);
  assert.equal(await healthy(async () => { throw new Error("offline"); }), false);
});

test("child exit immediately revokes renderer trust", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "rapp-zoo-supervisor-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  let calls = 0;
  let spawnOptions = null;
  let supervisor;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false };
    return {
      ok: true,
      json: async () => ({
        name: "rapp-zoo",
        schema: "rapp-zoo-health/1.0",
        status: "ok",
      }),
      headers: new Headers({
        "x-rapp-zoo-desktop": supervisor.desktopToken,
      }),
    };
  };
  supervisor = new ZooSupervisor({
    appRoot: "/tmp/app",
    userData,
    fetchImpl,
    spawnImpl: (_command, _args, options) => {
      spawnOptions = options;
      return child;
    },
  });
  supervisor.ensureRuntime = async () => process.execPath;
  await supervisor.start();
  assert.equal(spawnOptions.env.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(supervisor.state().trusted, true);
  child.emit("exit", 1, null);
  assert.equal(supervisor.state().state, "crashed");
  assert.equal(supervisor.state().trusted, false);
  assert.equal(supervisor.state().owned, false);
  if (supervisor.log) {
    await new Promise((resolve) => supervisor.log.end(resolve));
    supervisor.log = null;
  }
  rmSync(userData, { recursive: true, force: true });
});

test("zoo spawn errors fail without retaining trust", async () => {
  const userData = mkdtempSync(path.join(tmpdir(), "rapp-zoo-spawn-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const supervisor = new ZooSupervisor({
    appRoot: "/tmp/app",
    userData,
    fetchImpl: async () => ({ ok: false }),
    spawnImpl: () => {
      setImmediate(() => child.emit("error", new Error("spawn EACCES")));
      return child;
    },
  });
  supervisor.ensureRuntime = async () => process.execPath;
  try {
    await assert.rejects(supervisor.start(), /spawn EACCES/);
    assert.equal(supervisor.state().state, "failed");
    assert.equal(supervisor.state().trusted, false);
    assert.equal(supervisor.state().owned, false);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});
