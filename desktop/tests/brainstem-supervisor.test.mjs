import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BrainstemSupervisor,
  FOUNDRY_URL,
  readHealth,
} from "../brainstem-supervisor.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

test("health reader accepts only a live Brainstem", async () => {
  const good = await readHealth(async () => ({
    ok: true,
    json: async () => ({ status: "ok", agents: [] }),
  }));
  assert.equal(good.status, "ok");
  assert.equal(await readHealth(async () => ({
    ok: true,
    json: async () => ({ status: "wrong" }),
  })), null);
});

test("foundry health binds the dedicated soul and tools", () => {
  const supervisor = new BrainstemSupervisor({
    appRoot: "/tmp/rapp-zoo",
    userData: "/tmp/rapp-zoo-user",
  });
  assert.equal(supervisor.expectedHealth({
    status: "ok",
    brainstem_dir: "/tmp/rapp-zoo-brainstem",
    soul: "/tmp/rapp-zoo/holograms/brainstem-soul.md",
    agents: ["HologramForge", "HologramDOGG", "LearnNew"],
  }), false);
  const bound = new BrainstemSupervisor({
    appRoot: "/tmp/rapp-zoo",
    userData: "/tmp/rapp-zoo-user",
    brainstemSrc: "/tmp/rapp-zoo-brainstem",
  });
  assert.equal(bound.expectedHealth({
    status: "ok",
    brainstem_dir: "/tmp/rapp-zoo-brainstem",
    soul: "/tmp/rapp-zoo/holograms/brainstem-soul.md",
    agents: ["HologramForge", "HologramDOGG", "LearnNew"],
  }), true);
  assert.equal(supervisor.expectedHealth({
    status: "ok",
    brainstem_dir: "/tmp/rapp-zoo-brainstem",
    soul: "/tmp/other-soul.md",
    agents: ["HologramForge", "HologramDOGG"],
  }), false);
});

test("foundry chat preserves agent logs and session identity", async () => {
  const supervisor = new BrainstemSupervisor({
    appRoot: "/tmp/rapp-zoo",
    userData: "/tmp/rapp-zoo-user",
    fetchImpl: async (url, options) => {
      assert.equal(url, `${FOUNDRY_URL}/chat`);
      assert.match(options.body, /make a hologram/);
      return {
        ok: true,
        json: async () => ({
          response: '{"name":"result"}',
          agent_logs: "HologramForge",
          session_id: "session-1",
        }),
      };
    },
  });
  supervisor.currentState = "ready";
  const result = await supervisor.chat("make a hologram");
  assert.equal(result.response, '{"name":"result"}');
  assert.equal(result.agent_logs, "HologramForge");
  assert.equal(result.session_id, "session-1");
});

test("missing Brainstem fails without executing a remote installer", async () => {
  const supervisor = new BrainstemSupervisor({
    appRoot: "/tmp/rapp-zoo",
    userData: "/tmp/rapp-zoo-user",
    brainstemSrc: "/definitely/missing/rapp-brainstem",
    brainstemPython: "/definitely/missing/python",
    runImpl: async () => assert.fail("preflight must not run for missing files"),
  });
  await assert.rejects(
    supervisor.ensureInstalled(),
    /RAPP Brainstem is not installed/,
  );

  const source = readFileSync(
    path.resolve(here, "../brainstem-supervisor.mjs"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.doesNotMatch(source, /curl\s+-fsSL|irm\s+https?:|Invoke-Expression|\|\s*(?:bash|iex)/i);
});

test("spawn errors become a failed foundry state", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const userData = mkdtempSync(path.join(root, ".rapp-zoo-foundry-test-"));
  const supervisor = new BrainstemSupervisor({
    appRoot: "/tmp/rapp-zoo",
    userData,
    fetchImpl: async () => ({ ok: false }),
    spawnImpl: () => {
      setImmediate(() => child.emit("error", new Error("spawn EACCES")));
      return child;
    },
  });
  supervisor.ensureInstalled = async () => {};
  supervisor.installFoundryAgents = () => {};
  try {
    await assert.rejects(supervisor.start(), /spawn EACCES/);
    assert.equal(supervisor.state().state, "failed");
    assert.equal(supervisor.child, null);
    assert.equal(supervisor.owned, false);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
});

test("foundry installs the shared Python validator in its app-owned package", () => {
  const scratch = mkdtempSync(path.join(root, ".rapp-zoo-install-test-"));
  const brainstemSrc = path.join(scratch, "brainstem");
  const supervisor = new BrainstemSupervisor({
    appRoot: root,
    userData: path.join(scratch, "user"),
    brainstemSrc,
  });
  try {
    supervisor.installFoundryAgents();
    const protocolDir = path.join(
      brainstemSrc,
      "agents",
      "rapp_zoo_holo_protocol",
    );
    assert.equal(
      readFileSync(path.join(protocolDir, "holo_protocol.py"), "utf8"),
      readFileSync(path.join(root, "utils", "holo_protocol.py"), "utf8"),
    );
    assert.equal(
      readFileSync(path.join(protocolDir, "rapp_protocol.py"), "utf8"),
      readFileSync(path.join(root, "utils", "rapp_protocol.py"), "utf8"),
    );
    assert.equal(
      existsSync(path.join(
        brainstemSrc,
        "agents",
        "rapp_zoo_hologram_forge_agent.py",
      )),
      true,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
