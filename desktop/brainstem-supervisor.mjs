import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";


export const FOUNDRY_PORT = 7072;
export const FOUNDRY_URL = `http://127.0.0.1:${FOUNDRY_PORT}`;
const BRAINSTEM_HOME = path.join(homedir(), ".brainstem");
const BRAINSTEM_SRC = path.join(BRAINSTEM_HOME, "src", "rapp_brainstem");
const BRAINSTEM_PY = path.join(BRAINSTEM_SRC, "brainstem.py");
const BRAINSTEM_AGENTS = path.join(BRAINSTEM_SRC, "agents");
const BRAINSTEM_PYTHON = process.platform === "win32"
  ? path.join(BRAINSTEM_HOME, "venv", "Scripts", "python.exe")
  : path.join(BRAINSTEM_HOME, "venv", "bin", "python");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: options.stdio || ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

function sha256(pathname) {
  return createHash("sha256").update(readFileSync(pathname)).digest("hex");
}

async function readHealth(fetchImpl = globalThis.fetch) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const response = await fetchImpl(`${FOUNDRY_URL}/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const body = await response.json();
    return body?.status === "ok" ? body : null;
  } catch {
    return null;
  }
}

export class BrainstemSupervisor extends EventEmitter {
  constructor({
    appRoot,
    userData,
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
    runImpl = run,
    brainstemSrc = process.env.RAPP_ZOO_BRAINSTEM_PATH || BRAINSTEM_SRC,
    brainstemPython = (
      process.env.RAPP_ZOO_BRAINSTEM_PYTHON || BRAINSTEM_PYTHON
    ),
  }) {
    super();
    this.appRoot = appRoot;
    this.userData = userData;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.runImpl = runImpl;
    this.brainstemSrc = brainstemSrc;
    this.brainstemPy = path.join(brainstemSrc, "brainstem.py");
    this.brainstemAgents = path.join(brainstemSrc, "agents");
    this.brainstemPython = brainstemPython;
    this.child = null;
    this.owned = false;
    this.currentState = "stopped";
    this.health = null;
    this.activeRequest = null;
    this.log = null;
    this.soulPath = path.join(appRoot, "holograms", "brainstem-soul.md");
  }

  state() {
    return {
      state: this.currentState,
      url: FOUNDRY_URL,
      owned: this.owned,
      busy: Boolean(this.activeRequest),
      model: this.health?.model || null,
      tools: this.health?.agents || [],
      copilot: this.health?.copilot || null,
    };
  }

  setState(state) {
    this.currentState = state;
    this.emit("state", this.state());
  }

  async ensureInstalled() {
    if (!existsSync(this.brainstemPy) || !existsSync(this.brainstemPython)) {
      throw new Error(
        "RAPP Brainstem is not installed. Install a verified RAPP release "
        + "explicitly before launching the foundry, or set "
        + "RAPP_ZOO_BRAINSTEM_PATH and RAPP_ZOO_BRAINSTEM_PYTHON. "
        + `Expected ${this.brainstemPy} and ${this.brainstemPython}.`,
      );
    }
    await this.runImpl(this.brainstemPython, [
      "-c",
      "import flask, requests",
    ]);
  }

  installFoundryAgents() {
    mkdirSync(this.brainstemAgents, { recursive: true });
    const installFile = (source, destination, label) => {
      if (!existsSync(source)) throw new Error(`Missing ${label}: ${source}`);
      if (existsSync(destination) && sha256(source) !== sha256(destination)) {
        const backup = `${destination}.backup-${Date.now()}`;
        renameSync(destination, backup);
      }
      if (!existsSync(destination) || sha256(source) !== sha256(destination)) {
        copyFileSync(source, destination);
      }
    };
    for (const filename of [
      "hologram_dogg_agent.py",
      "hologram_forge_agent.py",
    ]) {
      installFile(
        path.join(this.appRoot, "agents", filename),
        path.join(this.brainstemAgents, `rapp_zoo_${filename}`),
        `foundry agent ${filename}`,
      );
    }
    const protocolDir = path.join(
      this.brainstemAgents,
      "rapp_zoo_holo_protocol",
    );
    mkdirSync(protocolDir, { recursive: true });
    for (const filename of ["holo_protocol.py", "rapp_protocol.py"]) {
      installFile(
        path.join(this.appRoot, "utils", filename),
        path.join(protocolDir, filename),
        `shared Holo protocol module ${filename}`,
      );
    }
  }

  expectedHealth(health) {
    return Boolean(
      health
      && health.status === "ok"
      && Array.isArray(health.agents)
      && health.agents.includes("HologramForge")
      && health.agents.includes("HologramDOGG")
      && path.resolve(health.brainstem_dir || "") === path.resolve(this.brainstemSrc)
      && path.resolve(health.soul || "") === path.resolve(this.soulPath)
    );
  }

  async start() {
    if (this.currentState === "ready" || this.currentState === "starting") {
      return this.state();
    }
    this.setState("starting");
    try {
      await this.ensureInstalled();
      this.installFoundryAgents();
    } catch (error) {
      this.setState("failed");
      throw error;
    }
    const existing = await readHealth(this.fetchImpl);
    if (existing) {
      if (!this.expectedHealth(existing)) {
        this.setState("conflict");
        throw new Error(`Port ${FOUNDRY_PORT} is occupied by another Brainstem.`);
      }
      this.health = existing;
      this.owned = false;
      this.setState("ready");
      return this.state();
    }

    const logDir = path.join(this.userData, "logs");
    mkdirSync(logDir, { recursive: true });
    this.log = createWriteStream(path.join(logDir, "hologram-foundry.log"), {
      flags: "a",
    });
    let launchedChild;
    try {
      launchedChild = this.spawnImpl(
        this.brainstemPython,
        [this.brainstemPy],
        {
          cwd: this.brainstemSrc,
          env: {
            ...process.env,
            PORT: String(FOUNDRY_PORT),
            SOUL_PATH: this.soulPath,
            AGENTS_PATH: this.brainstemAgents,
            GITHUB_MODEL: (
              process.env.RAPP_ZOO_BRAINSTEM_MODEL
              || "gpt-5.6-sol"
            ),
            PYTHONUNBUFFERED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      this.log.end();
      this.log = null;
      this.setState("failed");
      throw error;
    }
    this.child = launchedChild;
    let spawnError = null;
    this.owned = true;
    launchedChild.once("error", (error) => {
      spawnError = error;
      if (this.child === launchedChild) this.child = null;
      this.health = null;
      this.owned = false;
      this.log?.end();
      this.log = null;
      if (this.currentState !== "stopped") this.setState("failed");
    });
    launchedChild.stdout?.on("data", (chunk) => this.log?.write(chunk));
    launchedChild.stderr?.on("data", (chunk) => this.log?.write(chunk));
    launchedChild.on("exit", () => {
      if (this.child === launchedChild) this.child = null;
      this.health = null;
      this.owned = false;
      if (!["stopped", "failed"].includes(this.currentState)) {
        this.setState("crashed");
      }
    });

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Hologram Foundry Brainstem failed to start: ${spawnError.message}`);
      }
      const health = await readHealth(this.fetchImpl);
      if (this.expectedHealth(health)) {
        this.health = health;
        this.setState("ready");
        return this.state();
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await this.stop();
    this.setState("failed");
    throw new Error("Hologram Foundry Brainstem did not become ready.");
  }

  async chat(userInput) {
    if (this.currentState !== "ready") throw new Error("Hologram Foundry is not ready.");
    if (this.activeRequest) throw new Error("Hologram Foundry is already working.");
    const requestId = randomUUID();
    const controller = new AbortController();
    this.activeRequest = { requestId, controller };
    this.emit("state", this.state());
    try {
      const response = await this.fetchImpl(`${FOUNDRY_URL}/chat`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ user_input: userInput }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.response !== "string") {
        throw new Error(result.error || `Brainstem returned HTTP ${response.status}`);
      }
      return {
        requestId,
        response: result.response,
        agent_logs: result.agent_logs || null,
        session_id: result.session_id || null,
      };
    } finally {
      this.activeRequest = null;
      this.emit("state", this.state());
    }
  }

  cancel(requestId = null) {
    if (!this.activeRequest) return false;
    if (requestId && requestId !== this.activeRequest.requestId) return false;
    this.activeRequest.controller.abort();
    return true;
  }

  async stop() {
    this.cancel();
    this.currentState = "stopped";
    if (this.child && this.owned) {
      const child = this.child;
      this.child = null;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
    this.health = null;
    this.owned = false;
    this.log?.end();
    this.log = null;
    this.emit("state", this.state());
  }
}

export {
  BRAINSTEM_AGENTS,
  BRAINSTEM_HOME,
  BRAINSTEM_PY,
  BRAINSTEM_PYTHON,
  BRAINSTEM_SRC,
  readHealth,
};
