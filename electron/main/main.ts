import { confirmStartup, rollbackRestore, activeDirectory } from "./recovery";
import { pathToFileURL } from "node:url";
import { dialog } from "electron";
import { trustWindow, forgetWindow } from "./ipc/dispatch";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import type { Identity } from "@core/identity/public";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { FileImageStorage } from "@core/catalog/infrastructure/file-image-storage";
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { initializeDatabase, closeDatabase } from "./database";
import { registerIpcHandlers } from "./ipc";
import { createLogger } from "./logger";

const logger = createLogger("main");
let unregisterIpcHandlers: (() => void) | undefined;
let resourcesDisposed = false;
let startupInProgress = false;
let quitRequested = false;

function disposeApplication() {
  if (resourcesDisposed) return;
  resourcesDisposed = true;
  try {
    unregisterIpcHandlers?.();
  } finally {
    closeDatabase();
  }
}

async function createWindow(identity: Identity): Promise<BrowserWindow> {
  const developmentUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  const rendererFile = join(__dirname, "../renderer/index.html");
  const allowed = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(rendererFile).href;
  const isAllowedUrl = (url: string) => url.split("#")[0] === allowed.split("#")[0];
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

  try {
    const id = window.webContents.id;
    window.webContents.once("destroyed", () => {
      forgetWindow(id);
      identity.end(id);
    });
    trustWindow(id, isAllowedUrl);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event, url) => {
      if (!isAllowedUrl(url)) event.preventDefault();
    });
    window.once("ready-to-show", () => window.show());

    if (developmentUrl) await window.loadURL(developmentUrl);
    else await window.loadFile(rendererFile);
    if (window.isDestroyed() || !isAllowedUrl(window.webContents.getURL())) {
      throw new Error("The trusted renderer did not remain loaded");
    }
    return window;
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  startupInProgress = true;
  app.whenReady().then(async () => {
    let window: BrowserWindow | undefined;
    try {
      const dir = activeDirectory(app.getPath("userData"));
      const db = initializeDatabase(dir);
      const identity = createSqliteIdentity(db);
      unregisterIpcHandlers = registerIpcHandlers(
        db,
        createSqliteCatalog(db, new FileImageStorage(join(dir, "media"))),
        identity,
      );
      window = await createWindow(identity);
      confirmStartup(app.getPath("userData"));

      app.on("activate", async () => {
        if (resourcesDisposed || BrowserWindow.getAllWindows().length > 0) return;
        try {
          await createWindow(identity);
        } catch (error) {
          logger.error("Application window activation failed", error);
        }
      });
    } catch (error) {
      logger.error("Application startup failed", error);
      let startupError = error;
      try {
        try {
          if (window && !window.isDestroyed()) window.destroy();
        } finally {
          disposeApplication();
        }
        if (rollbackRestore(app.getPath("userData"))) {
          app.relaunch();
          app.exit(0);
          return;
        }
      } catch (recoveryError) {
        logger.error("Application startup recovery failed", recoveryError);
        startupError = recoveryError;
      } finally {
        startupInProgress = false;
      }
      dialog.showErrorBox("Warehouse WMS", String(startupError));
      app.quit();
      return;
    }
    startupInProgress = false;
    if (quitRequested) app.quit();
  });
}

app.on("window-all-closed", () => {
  if (!startupInProgress && !resourcesDisposed && process.platform !== "darwin") app.quit();
});
app.on("will-quit", (event) => {
  // Explicit quit can close the window while the initial load is still settling.
  if (startupInProgress) {
    event.preventDefault();
    quitRequested = true;
    return;
  }
  disposeApplication();
});
// Recovery uses app.exit(), which skips will-quit.
app.on("quit", disposeApplication);
