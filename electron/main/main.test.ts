import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { IpcMainInvokeEvent, ipcMain } from "electron";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

const rendererUrl = "http://localhost:5173/";
const rendererFile = join(__dirname, "../renderer/index.html");
const loadFailure = new Error("Renderer load failed");
const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
}

function setup({ development = false } = {}) {
  const ready = deferred();
  const loads = [deferred(), deferred(), deferred()];
  const started = loads.map(() => deferred());
  // The old Main drops the promise. Keep its rejection from aborting the test runner.
  for (const load of loads) void load.promise.catch(() => {});
  const windows: MockWindow[] = [];
  const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>();
  const errorBox = jest.fn();
  const logError = jest.fn();
  let startup!: Promise<void>;
  let quitting = false;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: !development,
    getPath: jest.fn(() => root),
    requestSingleInstanceLock: jest.fn(() => true),
    whenReady: () => ({
      then(callback: () => Promise<void>) {
        startup = ready.promise.then(callback);
        return startup;
      },
    }),
    quit: jest.fn(() => {
      if (quitting) return;
      quitting = true;
      app.emit("before-quit", { preventDefault: jest.fn() });
      for (const window of MockWindow.getAllWindows()) window.destroy();
      const preventDefault = jest.fn();
      app.emit("will-quit", { preventDefault });
      if (!preventDefault.mock.calls.length) app.emit("quit", {}, 0);
      quitting = false;
    }),
    relaunch: jest.fn(),
    exit: jest.fn(() => {
      quitting = true;
      for (const window of MockWindow.getAllWindows()) window.destroy();
      app.emit("quit", {}, 0);
      quitting = false;
    }),
  });

  class MockWindow extends EventEmitter {
    readonly index = windows.length;
    readonly webContents = Object.assign(new EventEmitter(), {
      id: this.index + 1,
      mainFrame: { url: development ? rendererUrl : pathToFileURL(rendererFile).href },
      setWindowOpenHandler: jest.fn(),
      getURL: () => this.webContents.mainFrame.url,
    });
    readonly show = jest.fn();
    readonly loadFile = jest.fn((_file: string) => this.load());
    readonly loadURL = jest.fn((_url: string) => this.load());
    private destroyed = false;

    constructor() {
      super();
      windows.push(this);
    }

    private load() {
      started[this.index].resolve();
      return loads[this.index].promise;
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy = jest.fn(() => {
      this.destroyed = true;
      this.webContents.emit("destroyed");
      this.emit("closed");
      if (!MockWindow.getAllWindows().length && !quitting) app.emit("window-all-closed");
    });

    static getAllWindows() {
      return windows.filter(window => !window.isDestroyed());
    }
  }

  jest.doMock("electron", () => ({
    app,
    BrowserWindow: MockWindow,
    dialog: { showErrorBox: errorBox },
    ipcMain: {
      handle: (channel: string, handler: Parameters<typeof ipcMain.handle>[1]) => {
        if (handlers.has(channel)) throw new Error("Duplicate handler " + channel);
        handlers.set(channel, handler);
      },
      removeHandler: (channel: string) => handlers.delete(channel),
    },
  }));
  jest.doMock("./logger", () => ({ createLogger: () => ({ info: jest.fn(), error: logError }) }));
  const db = require("./database") as typeof import("./database");
  closeFixture = db.closeDatabase;
  const close = jest.spyOn(db, "closeDatabase");
  const recovery = require("./recovery") as typeof import("./recovery");
  const confirm = jest.spyOn(recovery, "confirmStartup");
  const rollback = jest.spyOn(recovery, "rollbackRestore");
  const dispatch = require("./ipc/dispatch") as typeof import("./ipc/dispatch");
  const forget = jest.spyOn(dispatch, "forgetWindow");
  const ipc = require("./ipc") as typeof import("./ipc");
  const register = ipc.registerIpcHandlers;
  const dispose = jest.fn<() => void>();
  jest.spyOn(ipc, "registerIpcHandlers").mockImplementation((database, catalog, identity) => {
    const unregister = register(database, catalog, identity);
    dispose.mockImplementation(unregister);
    return dispose;
  });
  const identityModule = require("@core/identity/infrastructure/create-sqlite-identity") as typeof import("@core/identity/infrastructure/create-sqlite-identity");
  const createSqliteIdentity = identityModule.createSqliteIdentity;
  const end = jest.fn<(id: number) => void>();
  let identity!: ReturnType<typeof createSqliteIdentity>;
  const composeIdentity = jest.spyOn(identityModule, "createSqliteIdentity").mockImplementation(database => {
    const instance = createSqliteIdentity(database);
    end.mockImplementation(instance.end);
    identity = { ...instance, end };
    return identity;
  });
  if (development) process.env.ELECTRON_RENDERER_URL = rendererUrl;
  else delete process.env.ELECTRON_RENDERER_URL;

  function stageRestore() {
    const original = db.initializeDatabase(root);
    const backup = recovery.createVerifiedSnapshot(original, root, join(root, "backups"));
    closeFixture();
    const staged = recovery.stageRestore(backup, root);
    recovery.activate(root, staged);
    return join(root, staged);
  }

  function beginStartup() {
    require("./main");
    ready.resolve();
    return startup;
  }

  async function start() {
    beginStartup();
    await Promise.race([started[0].promise, startup]);
    if (!windows[0]?.loadFile.mock.calls.length && !windows[0]?.loadURL.mock.calls.length) {
      throw new Error("Startup finished before loading a renderer: " + logError.mock.calls.map(call => call.join(" ")));
    }
    return windows[0];
  }

  async function invoke(channel: string, window: MockWindow, input?: unknown) {
    const sender = window.webContents;
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    return handlers.get(channel)!(event, input);
  }

  return {
    app, loads, windows, start, beginStartup, stageRestore, invoke, handlers, close, confirm, rollback, forget, end,
    db, recovery, dispose, errorBox, logError, started, composeIdentity,
    get identity() { return identity; },
    get startup() { return startup; },
  };
}

let root: string;
let closeFixture: () => void;
const pendingRestore = () => existsSync(join(root, "restore-pending"));

beforeEach(() => {
  jest.resetModules();
  root = mkdtempSync(join(tmpdir(), "wms-main-"));
});

afterEach(() => {
  closeFixture?.();
  jest.restoreAllMocks();
  Object.defineProperty(process, "platform", originalPlatform);
  if (originalRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
  else process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
  rmSync(root, { recursive: true, force: true });
});

it.each(["file", "url"])("confirms a staged restore only after the initial %s load succeeds", async mode => {
  const qa = setup({ development: mode === "url" });
  const staged = qa.stageRestore();
  const window = await qa.start();
  if (mode === "url") expect(window.loadURL).toHaveBeenCalledWith(rendererUrl);
  else expect(window.loadFile).toHaveBeenCalledWith(rendererFile);
  expect(qa.confirm).not.toHaveBeenCalled();
  expect(pendingRestore()).toBe(true);

  const preventDefault = jest.fn();
  window.webContents.emit("will-redirect", { preventDefault }, window.webContents.mainFrame.url + "#/dashboard");
  expect(preventDefault).not.toHaveBeenCalled();
  window.webContents.emit("will-redirect", { preventDefault }, "https://untrusted.invalid/");
  expect(preventDefault).toHaveBeenCalledTimes(1);

  qa.loads[0].resolve();
  await qa.startup;
  expect(qa.confirm).toHaveBeenCalledTimes(1);
  expect(qa.confirm).toHaveBeenCalledWith(root);
  expect(pendingRestore()).toBe(false);
  expect(qa.recovery.activeDirectory(root)).toBe(staged);
  expect(qa.rollback).not.toHaveBeenCalled();
});

it("keeps rollback available if the load resolves at an untrusted URL", async () => {
  const qa = setup({ development: true });
  qa.stageRestore();
  const window = await qa.start();
  window.webContents.mainFrame.url = "https://untrusted.invalid/";
  qa.loads[0].resolve();
  await qa.startup;
  expect(qa.confirm).not.toHaveBeenCalled();
  expect(window.destroy).toHaveBeenCalledTimes(1);
  expect(qa.rollback).toHaveBeenCalledTimes(1);
  expect(qa.recovery.activeDirectory(root)).toBe(root);
  expect(qa.app.relaunch).toHaveBeenCalledTimes(1);
});

it.each(["file", "url"])("rolls back a staged restore after the initial %s load rejects", async mode => {
  setPlatform("win32");
  const qa = setup({ development: mode === "url" });
  const staged = qa.stageRestore();
  const window = await qa.start();
  const database = qa.db.getDatabase();
  const setupHandler = qa.handlers.get("identity:setup")!;
  const rollback = qa.rollback.getMockImplementation()!;
  qa.rollback.mockImplementation(path => {
    expect(pendingRestore()).toBe(true);
    expect(qa.recovery.activeDirectory(root)).toBe(staged);
    expect(qa.dispose).toHaveBeenCalledTimes(1);
    expect(qa.handlers.size).toBe(0);
    expect(database.open).toBe(false);
    expect(qa.app.quit).not.toHaveBeenCalled();
    expect(qa.forget).toHaveBeenCalledTimes(1);
    expect(qa.end).toHaveBeenCalledTimes(1);
    return rollback(path);
  });
  await expect(qa.invoke("identity:login", window, {
    name: "admin", password: "test-password-123", setup: true,
  })).resolves.toMatchObject({ ok: true });
  expect(qa.identity.actor(window.webContents.id)).toBeTruthy();
  qa.loads[0].reject(loadFailure);
  await qa.startup;
  expect(qa.confirm).not.toHaveBeenCalled();
  expect(qa.rollback).toHaveBeenCalledTimes(1);
  expect(qa.recovery.activeDirectory(root)).toBe(root);
  expect(pendingRestore()).toBe(false);
  expect(qa.app.relaunch).toHaveBeenCalledTimes(1);
  expect(qa.app.exit).toHaveBeenCalledTimes(1);
  expect(qa.app.exit).toHaveBeenCalledWith(0);
  expect(qa.errorBox).not.toHaveBeenCalled();
  expect(window.destroy).toHaveBeenCalledTimes(1);
  const sender = window.webContents;
  await expect(setupHandler({ sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent)).resolves.toMatchObject({
    ok: false, error: { code: "UNTRUSTED_SENDER" },
  });
  expect(() => qa.identity.actor(window.webContents.id)).toThrow(
    expect.objectContaining({ code: "AUTH_REQUIRED" }),
  );
  qa.app.emit("will-quit", { preventDefault: jest.fn() });
  expect(qa.dispose).toHaveBeenCalledTimes(1);
  expect(qa.close).toHaveBeenCalledTimes(1);
});

it("finishes rollback when the last window closes while startup is pending", async () => {
  setPlatform("win32");
  const qa = setup();
  qa.stageRestore();
  const window = await qa.start();
  window.destroy();
  expect(qa.app.quit).not.toHaveBeenCalled();
  expect(pendingRestore()).toBe(true);
  expect(qa.close).not.toHaveBeenCalled();
  qa.loads[0].reject(loadFailure);
  await qa.startup;
  expect(qa.rollback).toHaveBeenCalledTimes(1);
  expect(qa.app.relaunch).toHaveBeenCalledTimes(1);
  expect(qa.end).toHaveBeenCalledTimes(1);
  expect(qa.close).toHaveBeenCalledTimes(1);
});

it("defers explicit shutdown until a pending startup failure rolls back", async () => {
  const qa = setup();
  qa.stageRestore();
  await qa.start();
  const preventDefault = jest.fn();
  qa.app.emit("will-quit", { preventDefault });
  expect(preventDefault).toHaveBeenCalledTimes(1);
  expect(qa.close).not.toHaveBeenCalled();
  qa.loads[0].reject(loadFailure);
  await qa.startup;
  expect(qa.rollback).toHaveBeenCalledTimes(1);
  expect(qa.app.relaunch).toHaveBeenCalledTimes(1);
});

it("uses the usual error dialog and quit on an ordinary startup failure", async () => {
  const qa = setup();
  await qa.start();
  qa.loads[0].reject(loadFailure);
  await qa.startup;
  expect(qa.confirm).not.toHaveBeenCalled();
  expect(qa.rollback).toHaveBeenCalledWith(root);
  expect(qa.errorBox).toHaveBeenCalledTimes(1);
  expect(qa.errorBox).toHaveBeenCalledWith("Warehouse WMS", String(loadFailure));
  expect(qa.app.quit).toHaveBeenCalledTimes(1);
  expect(qa.dispose).toHaveBeenCalledTimes(1);
  expect(qa.close).toHaveBeenCalledTimes(1);
  expect(qa.handlers.size).toBe(0);
  expect(qa.app.relaunch).not.toHaveBeenCalled();
  qa.app.emit("window-all-closed");
  expect(qa.app.quit).toHaveBeenCalledTimes(1);
});

it("leaves only external handlers when startup registration fails before opening a window", async () => {
  const qa = setup();
  const external = jest.fn();
  qa.handlers.set("recovery:restore", external);
  const initialize = qa.db.initializeDatabase;
  let database: ReturnType<typeof initialize> | undefined;
  jest.spyOn(qa.db, "initializeDatabase").mockImplementation(directory => {
    database = initialize(directory);
    return database;
  });

  await qa.beginStartup();
  expect(database?.open).toBe(false);
  expect(qa.windows).toHaveLength(0);
  expect([...qa.handlers.entries()]).toEqual([["recovery:restore", external]]);
  expect(qa.close).toHaveBeenCalledTimes(1);
  expect(qa.errorBox).toHaveBeenCalledWith("Warehouse WMS", "Error: Duplicate handler recovery:restore");
});

it("reports a failed restore rollback after cleaning up application resources", async () => {
  const qa = setup();
  qa.stageRestore();
  const window = await qa.start();
  const database = qa.db.getDatabase();
  const rollbackFailure = new Error("Cannot update restore state");
  qa.rollback.mockImplementation(() => {
    expect(qa.handlers.size).toBe(0);
    expect(database.open).toBe(false);
    throw rollbackFailure;
  });

  qa.loads[0].reject(loadFailure);
  await qa.startup;
  expect(pendingRestore()).toBe(true);
  expect(window.isDestroyed()).toBe(true);
  expect(qa.errorBox).toHaveBeenCalledWith("Warehouse WMS", String(rollbackFailure));
  expect(qa.app.relaunch).not.toHaveBeenCalled();
  expect(qa.dispose).toHaveBeenCalledTimes(1);
  expect(qa.close).toHaveBeenCalledTimes(1);
});

it.each(["normal", "immediate"] as const)("removes every IPC handler before closing SQLite on %s shutdown", async mode => {
  setPlatform("win32");
  const qa = setup();
  const window = await qa.start();
  qa.loads[0].resolve();
  await qa.startup;
  const database = qa.db.getDatabase();
  const close = qa.close.getMockImplementation()!;
  qa.close.mockImplementation(() => {
    expect(qa.handlers.size).toBe(0);
    expect(qa.end).toHaveBeenCalledTimes(1);
    close();
  });

  if (mode === "normal") window.destroy();
  else qa.app.exit();
  qa.app.emit("will-quit", { preventDefault: jest.fn() });
  expect(database.open).toBe(false);
  expect(qa.dispose).toHaveBeenCalledTimes(1);
  expect(qa.close).toHaveBeenCalledTimes(1);
});

it("cleans up a failed macOS activation and can open another window", async () => {
  setPlatform("darwin");
  const qa = setup();
  const initial = await qa.start();
  qa.loads[0].resolve();
  await qa.startup;
  initial.destroy();
  const [activate] = qa.app.listeners("activate");
  const failedActivation = activate();
  await qa.started[1].promise;
  const failed = qa.windows[1];
  await expect(qa.invoke("identity:login", failed, {
    name: "admin", password: "test-password-123", setup: true,
  })).resolves.toMatchObject({ ok: true });
  qa.loads[1].reject(loadFailure);
  await failedActivation;
  expect(qa.logError).toHaveBeenCalledWith(expect.any(String), loadFailure);
  expect(failed.destroy).toHaveBeenCalledTimes(1);
  expect(qa.forget).toHaveBeenCalledWith(failed.webContents.id);
  expect(() => qa.identity.actor(failed.webContents.id)).toThrow(
    expect.objectContaining({ code: "AUTH_REQUIRED" }),
  );
  await expect(qa.invoke("identity:setup", failed)).resolves.toMatchObject({
    ok: false, error: { code: "UNTRUSTED_SENDER" },
  });
  expect(qa.app.quit).not.toHaveBeenCalled();
  expect(qa.dispose).not.toHaveBeenCalled();
  expect(qa.close).not.toHaveBeenCalled();

  const successfulActivation = activate();
  await qa.started[2].promise;
  qa.loads[2].resolve();
  await successfulActivation;
  await expect(qa.invoke("identity:setup", qa.windows[2])).resolves.toMatchObject({ ok: true, data: false });
  expect(qa.composeIdentity).toHaveBeenCalledTimes(1);
  expect(qa.composeIdentity).toHaveBeenCalledWith(qa.db.getDatabase());
  expect(qa.confirm).toHaveBeenCalledTimes(1);
  expect(qa.rollback).not.toHaveBeenCalled();
  expect(qa.app.relaunch).not.toHaveBeenCalled();
});
