import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CopilotBridge } from "./copilot-bridge.mjs";
import { desktopState } from "./contracts.mjs";
import { ZooSupervisor, ZOO_URL } from "./zoo-supervisor.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked")
  : path.resolve(dirname, "..");

app.setName("RAPP Zoo");
if (!app.isPackaged || process.env.RAPP_ZOO_DESKTOP_DEV === "1") {
  app.commandLine.appendSwitch(
    "remote-debugging-port",
    process.env.RAPP_ZOO_CDP_PORT || "9224",
  );
}

let mainWindow = null;
let supervisor = null;
const copilotWorkspace = path.join(homedir(), ".rapp-zoo", "copilot-workspace");
mkdirSync(copilotWorkspace, { recursive: true, mode: 0o700 });
const copilot = new CopilotBridge({ cwd: copilotWorkspace });

function trusted(event) {
  const raw = event.senderFrame?.url || event.sender.getURL();
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "7070") {
    throw new Error("IPC request did not originate from the local zoo.");
  }
  if (
    supervisor?.state().state !== "ready"
    || !supervisor?.state().trusted
  ) {
    throw new Error(
      "Copilot bridge is disabled because Electron did not launch this zoo process.",
    );
  }
}

async function intelligenceContext() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${ZOO_URL}/api/intelligence-context`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`context endpoint returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function broadcast(channel, value) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, value);
  }
}

copilot.on("chunk", (chunk) => broadcast("copilot:chunk", chunk));
copilot.on("state", () => {
  if (supervisor) {
    broadcast("desktop:state", desktopState({
      zoo: supervisor.state(),
      copilot: copilot.state(),
    }));
  }
});

ipcMain.handle("desktop:status", async (event) => {
  trusted(event);
  return desktopState({
    zoo: supervisor.state(),
    copilot: await copilot.version(),
  });
});
ipcMain.handle("copilot:status", async (event) => {
  trusted(event);
  return copilot.version();
});
ipcMain.handle("copilot:ask", async (event, prompt) => {
  trusted(event);
  const context = await intelligenceContext();
  return copilot.ask(prompt, context);
});
ipcMain.handle("copilot:cancel", (event, requestId) => {
  trusted(event);
  return { cancelled: copilot.cancel(requestId || null) };
});

function createMenu() {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open RAPP Zoo on GitHub",
          click: () => shell.openExternal("https://github.com/kody-w/rapp-zoo"),
        },
        {
          label: "Open in browser",
          click: () => shell.openExternal(ZOO_URL),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#0d1117",
    title: "RAPP Zoo",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged || process.env.RAPP_ZOO_DEVTOOLS === "1",
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  return mainWindow;
}

app.whenReady().then(async () => {
  createMenu();
  supervisor = new ZooSupervisor({
    appRoot,
    userData: app.getPath("userData"),
  });
  supervisor.on("state", (state) => {
    broadcast("desktop:state", desktopState({
      zoo: state,
      copilot: copilot.state(),
    }));
  });
  const window = createWindow();
  try {
    await supervisor.start();
    await window.loadURL(ZOO_URL);
  } catch (error) {
    const message = String(error?.message || error);
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="background:#0d1117;color:#f0f6fc;font:16px system-ui;padding:40px">
          <h1>RAPP Zoo could not start</h1><pre>${message.replace(/[&<>]/g, "")}</pre>
        </body>`,
      )}`,
    );
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const reopened = createWindow();
      reopened.loadURL(ZOO_URL);
    }
  });
});

app.on("before-quit", (event) => {
  if (supervisor?.state().state !== "stopped") {
    event.preventDefault();
    copilot.cancel();
    supervisor.stop().finally(() => app.quit());
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
