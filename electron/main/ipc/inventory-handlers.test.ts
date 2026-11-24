import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import Database from "better-sqlite3";
import { app, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { createSqliteCatalog } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { createSqliteIdentity } from "@core/identity/infrastructure/create-sqlite-identity";
import type { InventoryHistoryResult } from "@shared/inventory/types";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { IpcResult } from "@shared/ipc/result";
import type { StockCommand } from "@shared/ipc/stock";
import type { WarehouseDetailsDto } from "@shared/warehouses/types";
import { runMigrations } from "../database/migrations";
import { registerCatalogHandlers } from "./catalog-handlers";
import { forgetWindow, trustWindow } from "./dispatch";
import { registerIdentityHandlers } from "./identity-handlers";
import { registerIpcHandlers } from "./index";
import { registerInventoryHandlers } from "./inventory-handlers";
import { registerRecoveryHandlers } from "./recovery-handlers";
import { registerWarehouseHandlers } from "./warehouse-handlers";

jest.mock("electron", () => ({
  ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
  app: { getPath: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
}));

const { catalog: C, warehouses: W, inventory: I } = IPC_CHANNELS;
const queryChannels: readonly string[] = Object.values(I);
const frame = { url: "file:///inventory-test/index.html" };
const event = { sender: { id: 91, mainFrame: frame }, senderFrame: frame };
const anotherWindow = { ...event, sender: { ...event.sender, id: 92 } };
const password = "inventory-test-password";
const imageStorage = { save: () => "", read: () => null, remove: () => {} };
const maxQuantity = "9223372036854775.807";
const maxInteger = 9223372036854775807n;
const registered = new Map<string, Parameters<typeof ipcMain.handle>[1]>();

let db: Database.Database;
let identity: ReturnType<typeof createSqliteIdentity>;
let dispose: (() => void) | undefined;
let itemId: string;
let otherItemId: string;
let locationId: string;
let otherLocationId: string;
let warehouseId: string;
let baseUnitId: string;

async function invoke<T>(channel: string, input?: unknown, sender: unknown = event): Promise<IpcResult<T>> {
  const handler = registered.get(channel);
  if (!handler) throw Error("Unregistered channel " + channel);
  return await handler(sender as IpcMainInvokeEvent, input);
}

async function ok<T>(channel: string, input?: unknown): Promise<T> {
  const result = await invoke<T>(channel, input);
  if (!result.ok) throw Error(result.error.code + " " + result.error.message);
  if (queryChannels.includes(channel)) expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
  return result.data;
}

async function denied(channel: string, input: unknown, code: string, sender?: unknown) {
  await expect(invoke(channel, input, sender)).resolves.toMatchObject({ ok: false, error: { code } });
}

const login = (name: string, setup = false) => ok("identity:login", { name, password, setup });
const balanceRequest = () => ({ itemId, locationId });
const stock = (command: StockCommand) => ok<{ id: string }>("inventory:execute", command);
const createCatalog = () => createSqliteCatalog(db, imageStorage);
const registerApplication = () => registerIpcHandlers(db, createCatalog(), identity);
const unusedFactory = (): never => { throw Error("Unexpected factory call"); };

const catalogChannels = Object.values(C).flatMap(group => Object.values(group));
const warehouseChannels = [
  ...Object.values(W).flatMap(group => Object.values(group)),
  IPC_CHANNELS.identity.capabilities,
];
const identityChannels = ["identity:setup", "identity:login", "identity:add", "identity:logout"];
const recoveryChannels = ["recovery:backup", "recovery:restore"];
const applicationChannels = [
  ...catalogChannels, ...warehouseChannels, ...identityChannels, ...recoveryChannels, ...queryChannels,
  IPC_CHANNELS.system.getAppInfo, "inventory:execute",
];

async function post(kind: "receipt" | "issue", quantity: string) {
  const { id } = await stock({ op: "draft", kind, lines: [{ item: itemId, location: locationId, quantity }] });
  await stock({ op: "post", document: id, version: 1, command: "test/" + id });
  return id;
}

beforeEach(() => {
  registered.clear();
  dispose = undefined;
  jest.mocked(ipcMain.handle).mockReset().mockImplementation((channel, handler) => {
    if (registered.has(channel)) throw Error("Duplicate handler " + channel);
    registered.set(channel, handler);
  });
  jest.mocked(ipcMain.removeHandler).mockReset().mockImplementation(channel => {
    registered.delete(channel);
  });
  jest.spyOn(console, "info").mockImplementation(() => {});
  db = new Database(":memory:");
  runMigrations(db);
  identity = createSqliteIdentity(db);
  trustWindow(event.sender.id, url => url === frame.url);
});

async function seedInventory() {
  dispose = registerApplication();
  await login("admin", true);
  const branch = await ok<{ id: string }>(W.branches.create, { code: "BR", name: "Branch" });
  const warehouse = await ok<{ id: string }>(W.warehouses.create, {
    branchId: branch.id, code: "WH", name: "Warehouse",
  });
  warehouseId = warehouse.id;
  locationId = (await ok<WarehouseDetailsDto>(W.warehouses.get, { id: warehouseId })).defaultLocation.id;
  otherLocationId = (await ok<{ id: string }>(W.locations.create, {
    warehouseId, code: "BIN", name: "Bin", locationType: "bin",
  })).id;
  const category = await ok<{ id: string }>(C.categories.create, { code: "CAT", name: "Category" });
  baseUnitId = (await ok<{ id: string }>(C.units.create, { name: "Kilogram", symbol: "kg", dimension: "mass" })).id;
  const createItem = async (sku: string) => "p:" + (await ok<{ product: { id: string } }>(C.products.create, {
    name: sku, sku, categoryId: category.id, baseUnitId, productType: "simple", allowDecimalQuantity: true,
  })).product.id;
  itemId = await createItem("ITEM");
  otherItemId = await createItem("OTHER");
}

afterEach(() => {
  dispose?.();
  forgetWindow(event.sender.id);
  forgetWindow(anotherWindow.sender.id);
  if (db?.open) db.close();
  jest.restoreAllMocks();
});

it("rolls back a late application collision and permits full re-registration", () => {
  const collision = I.verifyBalanceConsistency;
  const external = jest.fn();
  ipcMain.handle(collision, external);
  ipcMain.handle("unrelated:ping", external);
  expect(() => registerApplication()).toThrow("Duplicate handler " + collision);
  expect([...registered.entries()]).toEqual([[collision, external], ["unrelated:ping", external]]);
  expect(jest.mocked(ipcMain.removeHandler).mock.calls.flat().sort())
    .toEqual(applicationChannels.filter(channel => channel !== collision).sort());

  ipcMain.removeHandler(collision);
  dispose = registerApplication();
  expect([...registered.keys()].sort()).toEqual(["unrelated:ping", ...applicationChannels].sort());
  dispose();
  expect([...registered.entries()]).toEqual([["unrelated:ping", external]]);
});

it("disposes all application handlers, preserving unrelated handlers even on repeat calls", () => {
  dispose = registerApplication();
  const external = jest.fn();
  ipcMain.handle("unrelated:ping", external);
  dispose();
  dispose();
  expect(jest.mocked(ipcMain.removeHandler).mock.calls.flat().sort()).toEqual([...applicationChannels].sort());
  expect([...registered.entries()]).toEqual([["unrelated:ping", external]]);
});

it.each([
  { group: "Catalog", channels: catalogChannels, register: () => registerCatalogHandlers(createCatalog(), identity, db) },
  { group: "Warehouse", channels: warehouseChannels, register: () => registerWarehouseHandlers(unusedFactory, identity.capabilities) },
  { group: "Identity", channels: identityChannels, register: () => registerIdentityHandlers(identity) },
  { group: "Recovery", channels: recoveryChannels, register: () => registerRecoveryHandlers(db, identity) },
  { group: "Inventory queries", channels: queryChannels, register: () => registerInventoryHandlers(unusedFactory) },
])("keeps standalone $group registration atomic and independently disposable", ({ channels, register }) => {
  const collision = channels[channels.length - 1];
  const external = jest.fn();
  ipcMain.handle("unrelated:ping", external);
  ipcMain.handle(collision, external);
  expect(() => register()).toThrow("Duplicate handler " + collision);
  expect([...registered.entries()]).toEqual([["unrelated:ping", external], [collision, external]]);
  expect(jest.mocked(ipcMain.removeHandler).mock.calls.flat().sort())
    .toEqual(channels.filter(channel => channel !== collision).sort());

  ipcMain.removeHandler(collision);
  dispose = register();
  expect([...registered.keys()].sort()).toEqual(["unrelated:ping", ...channels].sort());
  dispose();
  const firstDisposer = dispose;
  dispose = register();
  firstDisposer();
  expect([...registered.keys()].sort()).toEqual(["unrelated:ping", ...channels].sort());
  dispose();
  expect([...registered.entries()]).toEqual([["unrelated:ping", external]]);
});

it("revokes pending Identity setup before explicit application disposal closes SQLite", async () => {
  dispose = registerApplication();
  const pending = invoke("identity:login", { name: "admin", password, setup: true });
  dispose();
  db.close();
  await expect(pending).resolves.toEqual({
    ok: false, error: { code: "SESSION_CHANGED", message: "انتهت الجلسة" },
  });
});

it("cancels a pending Recovery dialog when application IPC is disposed", async () => {
  dispose = registerApplication();
  await login("admin", true);
  let selectFolder!: (result: Awaited<ReturnType<typeof dialog.showOpenDialog>>) => void;
  jest.mocked(dialog.showOpenDialog).mockReturnValueOnce(new Promise(resolve => { selectFolder = resolve; }));
  const pending = invoke("recovery:backup");
  dispose();
  db.close();
  selectFolder({ canceled: false, filePaths: ["unused"] });
  await expect(pending).resolves.toEqual({ ok: true, data: null });
  expect(app.getPath).not.toHaveBeenCalled();
});

describe("Inventory queries through application IPC", () => {
  beforeEach(seedInventory);

  it("reuses the managed database and returns plain DTOs with exact, zero and missing quantities", async () => {
    const request = balanceRequest();
    const fields = { ...request, warehouseId, baseUnitId };
    await expect(ok(I.getStockBalance, request)).resolves.toEqual({ ...fields, onHand: null });
    await expect(ok(I.getAvailableQuantity, request)).resolves.toEqual({ ...fields, onHand: null, available: null });
    await post("receipt", maxQuantity);
    await expect(ok(I.getStockBalance, request)).resolves.toEqual({ ...fields, onHand: maxQuantity });
    await expect(ok(I.getAvailableQuantity, request)).resolves.toEqual({ ...fields, onHand: maxQuantity, available: maxQuantity });
    const balances = [{ ...request, warehouseId, onHand: maxQuantity }];
    await expect(ok(I.getStockItemStock, { itemId })).resolves.toEqual({ itemId, baseUnitId, onHand: maxQuantity, balances });
    await expect(ok(I.getWarehouseStock, { warehouseId })).resolves.toEqual({ warehouseId, items: [{ itemId, onHand: maxQuantity, balances }] });
    const issue = await post("issue", maxQuantity);
    await expect(ok(I.getStockBalance, request)).resolves.toEqual({ ...fields, onHand: "0.000" });
    await expect(ok(I.getAvailableQuantity, request)).resolves.toEqual({ ...fields, onHand: "0.000", available: "0.000" });
    const history = await ok<InventoryHistoryResult>(I.getInventoryHistory, request);
    expect(history.movements.map(({ delta }) => delta)).toEqual(["-" + maxQuantity, maxQuantity]);
    expect(history.movements[0].documentId).toBe(issue);
  });

  it("rejects malformed input and gives pagination errors their own public code", async () => {
    for (const input of [null, [], {}, 123, { itemId: 4, locationId }, { itemId: "invalid", locationId },
      { itemId, locationId: " " }, { ...balanceRequest(), actor: "fake-admin" }]) {
      await denied(I.getStockBalance, input, "VALIDATION_ERROR");
    }
    await denied(I.getStockItemStock, { itemId, warehouseId }, "VALIDATION_ERROR");
    await denied(I.getWarehouseStock, { warehouseId: 123 }, "VALIDATION_ERROR");
    await denied(I.getAvailableQuantity, { itemId }, "VALIDATION_ERROR");
    await denied(I.verifyBalanceConsistency, { itemId }, "VALIDATION_ERROR");
    await denied(I.getInventoryHistory, { itemId, locationId: null }, "VALIDATION_ERROR");
    for (const limit of [0, 201, 1.5, "2"]) {
      await denied(I.getInventoryHistory, { itemId, limit }, "INVALID_HISTORY_PAGINATION");
    }
    for (const beforeMovementId of [1, "1.2", "9223372036854775808", "-9223372036854775809"]) {
      await denied(I.getInventoryHistory, { itemId, beforeMovementId }, "INVALID_HISTORY_PAGINATION");
    }
  });

  it("uses the live read grant and rejects stale windows, foreign frames and forged actors", async () => {
    const requests = [
      [I.getStockBalance, balanceRequest()],
      [I.getStockItemStock, { itemId }],
      [I.getWarehouseStock, { warehouseId }],
      [I.getAvailableQuantity, balanceRequest()],
      [I.getInventoryHistory, { itemId }],
      [I.verifyBalanceConsistency, balanceRequest()],
    ] as const;
    await ok(I.getStockBalance, balanceRequest());
    await denied(I.getStockBalance, balanceRequest(), "UNTRUSTED_SENDER", anotherWindow);
    trustWindow(anotherWindow.sender.id, url => url === frame.url);
    await denied(I.getStockBalance, balanceRequest(), "AUTH_REQUIRED", anotherWindow);
    await denied(I.getStockBalance, balanceRequest(), "UNTRUSTED_SENDER", { ...event, senderFrame: { ...frame } });
    const foreignFrame = { url: "https://example.test/" };
    await denied(I.getStockBalance, balanceRequest(), "UNTRUSTED_SENDER", {
      sender: { ...event.sender, mainFrame: foreignFrame }, senderFrame: foreignFrame,
    });
    await ok("identity:add", { name: "clerk", password, roles: ["clerk"] });
    await login("clerk");
    await ok(I.getStockBalance, balanceRequest());
    db.prepare("DELETE FROM permissions WHERE role='clerk' AND action='read'").run();
    for (const [channel, request] of requests) await denied(channel, request, "FORBIDDEN");
    await denied(I.getStockBalance, { ...balanceRequest(), actor: identity.actor(event.sender.id) }, "VALIDATION_ERROR");
    await login("admin");
    await ok(I.getStockBalance, balanceRequest());
    await ok("identity:logout");
    for (const [channel, request] of requests) await denied(channel, request, "AUTH_REQUIRED");
    await login("admin");
    forgetWindow(event.sender.id);
    for (const [channel, request] of requests) await denied(channel, request, "UNTRUSTED_SENDER");
  });

  it("filters and bounds history with an exclusive cursor beyond the safe JavaScript integer range", async () => {
    const document = "history-fixture";
    db.prepare("INSERT INTO documents(id,kind,state,lines) VALUES(?,'receipt','draft','[]')").run(document);
    const insert = db.prepare("INSERT INTO movements(id,document,line,item,location,delta,snapshot) VALUES(?,?,?,?,?,1,'{}')");
    db.transaction(() => {
      for (let index = 0; index < 205; index++) {
        insert.run(maxInteger - BigInt(index + 2), document, index, itemId, locationId);
      }
      insert.run(maxInteger - 1n, document, 205, otherItemId, locationId);
      insert.run(maxInteger, document, 206, itemId, otherLocationId);
    })();

    const filter = { itemId, locationId, limit: 200 };
    const first = await ok<InventoryHistoryResult>(I.getInventoryHistory, filter);
    const cursor = (maxInteger - 201n).toString();
    expect(first.movements.map(move => move.movementId)).toEqual(
      Array.from({ length: 200 }, (_, index) => (maxInteger - BigInt(index + 2)).toString()),
    );
    expect(first.movements.every(move => move.itemId === itemId && move.locationId === locationId)).toBe(true);
    expect(first.nextBeforeMovementId).toBe(cursor);
    const last = await ok<InventoryHistoryResult>(I.getInventoryHistory, { ...filter, beforeMovementId: cursor });
    expect(last.movements.map(move => move.movementId)).toEqual(
      Array.from({ length: 5 }, (_, index) => (maxInteger - BigInt(index + 202)).toString()),
    );
    expect(last.nextBeforeMovementId).toBeNull();
    const unfiltered = await ok<InventoryHistoryResult>(I.getInventoryHistory, { itemId });
    expect(unfiltered.movements).toHaveLength(100);
    expect(unfiltered.movements[0]).toMatchObject({ movementId: maxInteger.toString(), locationId: otherLocationId });
    expect(unfiltered.movements.every(move => move.itemId === itemId)).toBe(true);
  });

  it("reports exact discrepancies and leaves balances, movements and audit untouched", async () => {
    const request = balanceRequest();
    const fields = { ...request, warehouseId, baseUnitId };
    await post("receipt", maxQuantity);
    await expect(ok(I.verifyBalanceConsistency, request)).resolves.toEqual({ ...fields, discrepancies: [] });
    db.prepare("UPDATE balances SET qty=? WHERE item=? AND location=?").run(maxInteger - 1n, itemId, locationId);
    const before = db.serialize();
    await expect(ok(I.verifyBalanceConsistency, request)).resolves.toEqual({
      ...fields, discrepancies: [{ onHand: "9223372036854775.806", ledger: maxQuantity }],
    });
    expect(db.serialize()).toEqual(before);
  });

  it("distinguishes unknown definitions and sanitizes database and unexpected errors", async () => {
    await denied(I.getStockBalance, { ...balanceRequest(), itemId: "p:unknown" }, "STOCK_ITEM_NOT_FOUND");
    await denied(I.getWarehouseStock, { warehouseId: "unknown" }, "WAREHOUSE_NOT_FOUND");
    await denied(I.verifyBalanceConsistency, { itemId, locationId: "unknown" }, "LOCATION_NOT_FOUND");
    await denied(I.getInventoryHistory, { itemId, locationId: "unknown" }, "LOCATION_NOT_FOUND");
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(identity, "actor").mockImplementationOnce(() => {
      throw Error("private-session-secret SELECT FROM secret.db");
    });
    await expect(invoke(I.getStockBalance, balanceRequest())).resolves.toEqual({
      ok: false, error: { code: "INTERNAL_ERROR", message: "حدث خطأ غير متوقع" },
    });
    expect(log).toHaveBeenCalledTimes(1);
    db.exec("ALTER TABLE balances RENAME TO private_balances");
    await expect(invoke(I.getStockBalance, balanceRequest())).resolves.toEqual({
      ok: false, error: { code: "BALANCE_READ_FAILED", message: "تعذّرت قراءة أرصدة المخزون" },
    });
    db.exec("ALTER TABLE movements RENAME TO private_movements");
    await expect(invoke(I.verifyBalanceConsistency, balanceRequest())).resolves.toEqual({
      ok: false, error: { code: "INVENTORY_READ_FAILED", message: "تعذّرت قراءة بيانات المخزون" },
    });
  });
});
