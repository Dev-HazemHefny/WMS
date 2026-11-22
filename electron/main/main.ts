import { confirmStartup, rollbackRestore, activeDirectory } from "./recovery";
import { pathToFileURL } from "node:url";
import { dialog } from "electron";
import { trustWindow, forgetWindow } from "./ipc/dispatch";
import {
  createIdentity,
  type Identity,
} from "@core/identity/application/identity";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { initializeDatabase, closeDatabase } from "./database";
import { registerIpcHandlers } from "./ipc";
import { createLogger } from "./logger";

const logger = createLogger("main");

function createWindow(identity: Identity): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const id = window.webContents.id;
  const allowed =
    process.env.ELECTRON_RENDERER_URL && !app.isPackaged
      ? new URL(process.env.ELECTRON_RENDERER_URL).href
      : pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  trustWindow(id, (url) => url.split("#")[0] === allowed.split("#")[0]);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] !== allowed.split("#")[0]) event.preventDefault();
  });
  window.webContents.once("destroyed", () => {
    forgetWindow(id);
    identity.end(id);
  });
  window.once("ready-to-show", () => window.show());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else
  app.whenReady().then(async () => {
    try {
      const dir = activeDirectory(app.getPath("userData"));
      const db = await initializeDatabase(dir);
      const identity = createIdentity(db);
      registerIpcHandlers(
        db,
        createSqliteCatalog(db, new FileImageStorage(join(dir, "media"))),
        identity,
      );
      createWindow(identity);
      confirmStartup(app.getPath("userData"));

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow(identity);
      });
    } catch (error) {
      logger.error("Application startup failed", error);
      closeDatabase();
      if (rollbackRestore(app.getPath("userData"))) {
        app.relaunch();
        app.exit(0);
        return;
      }
      dialog.showErrorBox("Warehouse WMS", String(error));
      app.quit();
    }
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("will-quit", closeDatabase);
