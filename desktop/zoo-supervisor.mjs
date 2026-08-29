import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";

const ZOO_URL = "http://127.0.0.1:7070";

function pythonIn(venv) {
  return process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
}

function pipIn(venv) {
  return process.platform === "win32"
    ? path.join(venv, "Scripts", "pip.exe")
    : path.join(venv, "bin", "pip");
}

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

async function healthy(fetchImpl = globalThis.fetch, expectedToken = null) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    const response = await fetchImpl(`${ZOO_URL}/api/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!response.ok) return false;
    const body = await response.json();
    if (
      body?.name !== "rapp-zoo"
      || body?.schema !== "rapp-zoo-health/1.0"
      || body?.status !== "ok"
    ) {
      return false;
    }
    if (
      expectedToken
      && response.headers.get("x-rapp-zoo-desktop") !== expectedToken
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export class ZooSupervisor extends EventEmitter {
  constructor({
    appRoot,
    userData,
    fetchImpl = globalThis.fetch,
    spawnImpl = spawn,
  }) {
    super();
    this.appRoot = appRoot;
    this.userData = userData;
    this.fetchImpl = fetchImpl;
    this.spawnImpl = spawnImpl;
    this.child = null;
    this.owned = false;
    this.trusted = false;
    this.desktopToken = randomBytes(32).toString("hex");
    this.currentState = "stopped";
    this.log = null;
  }

  state() {
    return {
      state: this.currentState,
      url: ZOO_URL,
      owned: this.owned,
      trusted: this.trusted,
    };
  }

  setState(state) {
    if (state === this.currentState) return;
    this.currentState = state;
    this.emit("state", this.state());
  }

  async ensureRuntime() {
    if (process.env.RAPP_ZOO_PYTHON) {
      await run(process.env.RAPP_ZOO_PYTHON, [
        "-c",
        "import flask, cryptography",
      ]);
      return process.env.RAPP_ZOO_PYTHON;
    }
    const venv = path.join(this.userData, "python");
    const python = pythonIn(venv);
    if (existsSync(python)) {
      try {
        await run(python, ["-c", "import flask, cryptography"]);
        return python;
      } catch {
        // Reinstall into the existing private runtime below.
      }
    }
    const systemPython = process.platform === "win32" ? "python" : "python3";
    if (!existsSync(python)) {
      await run(systemPython, ["-m", "venv", venv]);
    }
    await run(pipIn(venv), [
      "install",
      "--disable-pip-version-check",
      "-r",
      path.join(this.appRoot, "installer", "requirements.txt"),
    ]);
    return python;
  }

  async start() {
    if (this.currentState === "ready" || this.currentState === "starting") {
      return this.state();
    }
    this.setState("starting");
    if (await healthy(this.fetchImpl)) {
      this.owned = false;
      this.trusted = false;
      this.setState("ready");
      return this.state();
    }
    const python = await this.ensureRuntime();
    const logDir = path.join(this.userData, "logs");
    mkdirSync(logDir, { recursive: true });
    this.log = createWriteStream(path.join(logDir, "zoo.log"), { flags: "a" });
    let launchedChild;
    try {
      launchedChild = this.spawnImpl(
        python,
        [path.join(this.appRoot, "zoo.py")],
        {
          cwd: this.appRoot,
          env: {
            ...process.env,
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONUNBUFFERED: "1",
            RAPP_ZOO_HOST: "127.0.0.1",
            RAPP_ZOO_PORT: "7070",
            RAPP_ZOO_DESKTOP_TOKEN: this.desktopToken,
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
      this.trusted = false;
      this.owned = false;
      this.log?.end();
      this.log = null;
      if (this.currentState !== "stopped") this.setState("failed");
    });
    launchedChild.stdout?.on("data", (chunk) => this.log?.write(chunk));
    launchedChild.stderr?.on("data", (chunk) => this.log?.write(chunk));
    launchedChild.on("exit", () => {
      if (this.child === launchedChild) this.child = null;
      this.trusted = false;
      this.owned = false;
      if (!["stopped", "failed"].includes(this.currentState)) {
        this.setState("crashed");
      }
    });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`The local zoo failed to start: ${spawnError.message}`);
      }
      if (await healthy(this.fetchImpl, this.desktopToken)) {
        this.trusted = true;
        this.setState("ready");
        return this.state();
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await this.stop();
    this.setState("failed");
    throw new Error("The local zoo did not become healthy within 60 seconds.");
  }

  async stop() {
    this.setState("stopped");
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
    this.owned = false;
    this.trusted = false;
    this.log?.end();
    this.log = null;
  }
}

export { ZOO_URL, healthy, pipIn, pythonIn };
