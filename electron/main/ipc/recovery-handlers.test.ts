import { afterEach, beforeEach, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { app, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogReturnValue } from "electron";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import type { IpcResult } from "@shared/ipc/result";
import { runMigrations } from "../database/migrations";
import { activeDirectory, createVerifiedSnapshot } from "../recovery";
import { forgetWindow, trustWindow } from "./dispatch";
import { registerIdentityHandlers } from "./identity-handlers";
import { registerRecoveryHandlers } from "./recovery-handlers";

jest.mock("electron", () => ({
  app: { getPath: jest.fn(), relaunch: jest.fn(), exit: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
  ipcMain: { handle: jest.fn() },
}));

const frame = { url: "file:///recovery-test/index.html" };
const windowId = 94;
const event = { sender: { id: windowId, mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
const password = "recovery-fixture-password";
const handlers = new Map<string, Parameters<typeof ipcMain.handle>[1]>();
type Action = "backup" | "restore";
let root: string;
let db: Database.Database;
let identity: ReturnType<typeof createSqliteIdentity>;
let source: string;
let actor: string;

function invoke(channel: string): Promise<IpcResult<string | null | undefined>> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error("Missing handler " + channel);
  return handler(event, undefined);
}

function start(action: Action) {
  let finish!: (folder: OpenDialogReturnValue) => void;
  jest.mocked(dialog.showOpenDialog).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const result = invoke("recovery:" + action);
  expect(dialog.showOpenDialog).toHaveBeenCalledTimes(1);
  return {
    result,
    select: () => finish({ canceled: false, filePaths: [action === "restore" ? source : join(root, "export")] }),
    cancel: () => finish({ canceled: true, filePaths: [] }),
  };
}

function state() {
  return {
    files: readdirSync(root, { recursive: true }).sort(),
    active: activeDirectory(root),
    operators: db.prepare("SELECT * FROM operators ORDER BY id").all(),
    roles: db.prepare("SELECT * FROM operator_roles ORDER BY operator,role").all(),
    audit: db.prepare("SELECT * FROM audit ORDER BY id").all(),
  };
}

function expectNoEffects(before: ReturnType<typeof state>) {
  expect(state()).toEqual(before);
  expect(app.getPath).not.toHaveBeenCalled();
  expect(app.relaunch).not.toHaveBeenCalled();
  expect(app.exit).not.toHaveBeenCalled();
}

beforeEach(async () => {
  jest.resetAllMocks();
  root = mkdtempSync(join(tmpdir(), "wms-recovery-ipc-"));
  db = new Database(join(root, "warehouse.sqlite"));
  runMigrations(db);
  identity = createSqliteIdentity(db);
  await identity.login(windowId, "admin", password, true);
  actor = identity.actor(windowId);
  source = createVerifiedSnapshot(db, root, join(root, "source"));
  handlers.clear();
  jest.mocked(app.getPath).mockReturnValue(root);
  jest.mocked(ipcMain.handle).mockImplementation((channel, handler) => { handlers.set(channel, handler); });
  trustWindow(windowId, url => url === frame.url);
  registerIdentityHandlers(identity);
  registerRecoveryHandlers(db, identity);
});

afterEach(() => {
  forgetWindow(windowId);
  db.close();
  rmSync(root, { recursive: true, force: true });
});

it.each<Action>(["backup", "restore"])("rejects %s when the same actor logs back in while the directory dialog is open", async action => {
  const before = state();
  const pending = start(action);
  await expect(invoke("identity:logout")).resolves.toMatchObject({ ok: true });
  await identity.login(windowId, "admin", password, false);
  expect(identity.actor(windowId)).toBe(actor);
  pending.select();
  await expect(pending.result).resolves.toMatchObject({ ok: false, error: { code: "SESSION_CHANGED" } });
  expectNoEffects(before);
});

it("rejects a pending backup after IPC logout", async () => {
  const before = state();
  const pending = start("backup");
  await expect(invoke("identity:logout")).resolves.toMatchObject({ ok: true });
  pending.select();
  await expect(pending.result).resolves.toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  expectNoEffects(before);
});

it("rejects a pending restore after the destroyed-window cleanup revokes trust and ends its session", async () => {
  const before = state();
  const pending = start("restore");
  // These are the two callbacks the Main destroyed-WebContents handler invokes.
  forgetWindow(windowId);
  identity.end(windowId);
  pending.select();
  await expect(pending.result).resolves.toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
  await expect(invoke("recovery:restore")).resolves.toMatchObject({ ok: false, error: { code: "UNTRUSTED_SENDER" } });
  expectNoEffects(before);
});

it("reports SESSION_CHANGED when a different authorized actor takes over the window", async () => {
  await identity.addOperator(windowId, "other-admin", password, ["admin"]);
  const before = state();
  const pending = start("backup");
  await identity.login(windowId, "other-admin", password, false);
  pending.select();
  await expect(pending.result).resolves.toMatchObject({ ok: false, error: { code: "SESSION_CHANGED" } });
  expectNoEffects(before);
});

it.each<Action>(["backup", "restore"])("rechecks the live %s grant after the dialog", async action => {
  const before = state();
  const pending = start(action);
  db.prepare("DELETE FROM permissions WHERE role='admin' AND action=?").run(action);
  pending.select();
  await expect(pending.result).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  expectNoEffects(before);
});

it.each<Action>(["backup", "restore"])("cancels %s without effects even after logout", async action => {
  const before = state();
  const pending = start(action);
  await invoke("identity:logout");
  pending.cancel();
  await expect(pending.result).resolves.toEqual({ ok: true, data: null });
  expectNoEffects(before);
});

it("creates a snapshot and audit row for an uninterrupted backup", async () => {
  const pending = start("backup");
  pending.select();
  const result = await pending.result;
  expect(result.ok).toBe(true);
  if (!result.ok || typeof result.data !== "string") throw new Error("Expected a snapshot path");
  expect(existsSync(join(result.data, "manifest.json"))).toBe(true);
  expect(activeDirectory(root)).toBe(root);
  expect(state().audit).toMatchObject([{ actor, action: "backup", target: result.data }]);
  expect(app.relaunch).not.toHaveBeenCalled();
});

it("stages, activates, audits and requests a relaunch for an uninterrupted restore", async () => {
  const pending = start("restore");
  pending.select();
  await expect(pending.result).resolves.toEqual({ ok: true, data: null });
  const dataset = readFileSync(join(root, "active-dataset"), "utf8");
  expect(activeDirectory(root)).toBe(join(root, dataset));
  expect(existsSync(join(root, "restore-pending"))).toBe(true);
  expect(readdirSync(join(root, "backups"))).toHaveLength(1);
  expect(state().audit).toMatchObject([{ actor, action: "restore", target: dataset }]);
  expect(app.relaunch).toHaveBeenCalledTimes(1);
  expect(app.exit).toHaveBeenCalledWith(0);
});
