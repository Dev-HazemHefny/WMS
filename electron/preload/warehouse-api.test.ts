import { beforeEach, expect, it, jest } from "@jest/globals";
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { WarehouseApi } from "@shared/ipc/contracts";
import { ClientError } from "@shared/ipc/client-error";

jest.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: { invoke: jest.fn() },
}));
import "./index";

const api = jest.mocked(contextBridge.exposeInMainWorld).mock.calls[0][1] as WarehouseApi;
const methods = Object.entries(IPC_CHANNELS.warehouses).flatMap(([group, channels]) =>
  Object.entries(channels).map(([method, channel]) => ({ group, method, channel })),
);
beforeEach(() => { jest.mocked(ipcRenderer.invoke).mockReset(); });

it("exposes only the approved namespace and named Warehouse methods", () => {
  expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
  expect(jest.mocked(contextBridge.exposeInMainWorld).mock.calls[0][0]).toBe("warehouse");
  expect(Object.keys(api).sort()).toEqual(["catalog", "identity", "inventory", "recovery", "system", "warehouses"]);
  for (const [group, channels] of Object.entries(IPC_CHANNELS.warehouses)) {
    expect(Object.keys(api.warehouses[group as keyof typeof api.warehouses]).sort()).toEqual(Object.keys(channels).sort());
  }
  expect(api).not.toHaveProperty("invoke");
  expect(api).not.toHaveProperty("ipcRenderer");
  expect(api.warehouses).not.toHaveProperty("execute");
});
it.each(methods)("forwards $group.$method only to $channel and unwraps its result", async ({group,method,channel}) => {
  // Runtime bridge contract: Main, not preload, validates untrusted payloads.
  const input = { id: "fixture", expectedVersion: 1 }, data = { result: "fixture" };
  jest.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ok:true,data});
  const groupApi = api.warehouses[group as keyof typeof api.warehouses];
  const invoke = (groupApi as unknown as Record<string,(input:unknown)=>Promise<unknown>>)[method];
  await expect(invoke(input)).resolves.toEqual(data);
  expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
  expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel,input);
});
it("queries fresh capabilities without accepting client identity claims", async () => {
  const admin = {authenticated:true,permissions:["read","warehouse"]};
  const signedOut = {authenticated:false,permissions:[]};
  jest.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ok:true,data:admin}).mockResolvedValueOnce({ok:true,data:signedOut});
  await expect(api.identity.getCapabilities()).resolves.toEqual(admin);
  await expect(api.identity.getCapabilities()).resolves.toEqual(signedOut);
  expect(jest.mocked(ipcRenderer.invoke).mock.calls).toEqual([
    [IPC_CHANNELS.identity.capabilities,undefined],[IPC_CHANNELS.identity.capabilities,undefined],
  ]);
});
it("preserves the Identity methods and their IPC payloads", async () => {
  expect(Object.keys(api.identity).sort()).toEqual(["add", "getCapabilities", "login", "logout", "setupRequired"]);
  const login = { name: "admin", password: "test-password-123", setup: true };
  const add = { name: "operator", password: "test-password-456", roles: ["clerk" as const] };
  jest.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: true }).mockResolvedValueOnce({ ok: true, data: true });
  await expect(api.identity.setupRequired()).resolves.toBe(true);
  await expect(api.identity.login(login)).resolves.toBeUndefined();
  await expect(api.identity.add(add)).resolves.toBeUndefined();
  await expect(api.identity.logout()).resolves.toBeUndefined();
  expect(jest.mocked(ipcRenderer.invoke).mock.calls).toEqual([
    ["identity:setup", undefined], ["identity:login", login], ["identity:add", add], ["identity:logout", undefined],
  ]);
});
it("retains application error codes through the existing ClientError convention", async () => {
  jest.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ok:false,error:{code:"VERSION_CONFLICT",message:"Reload"}});
  await expect(api.warehouses.locations.reparent({id:"fixture",parentId:null,expectedVersion:1})).rejects.toEqual(new ClientError("VERSION_CONFLICT","Reload"));
});
it("keeps legacy Catalog and Inventory channels intact", async () => {
  jest.mocked(ipcRenderer.invoke).mockResolvedValue({ok:true,data:[]});
  await api.catalog.products.lookup();
  await api.inventory.execute({op:"balances"});
  expect(jest.mocked(ipcRenderer.invoke).mock.calls).toEqual([
    [IPC_CHANNELS.catalog.products.lookup,undefined],["inventory:execute",{op:"balances"}],
  ]);
});

const balanceRequest = { itemId: "p:fixture", locationId: "bin" };
const inventoryCases: [keyof typeof IPC_CHANNELS.inventory, object, () => Promise<unknown>][] = [
  ["getStockBalance", balanceRequest, () => api.inventory.getStockBalance(balanceRequest)],
  ["getStockItemStock", { itemId: "p:fixture" }, () => api.inventory.getStockItemStock({ itemId: "p:fixture" })],
  ["getWarehouseStock", { warehouseId: "wh" }, () => api.inventory.getWarehouseStock({ warehouseId: "wh" })],
  ["getAvailableQuantity", balanceRequest, () => api.inventory.getAvailableQuantity(balanceRequest)],
  ["getInventoryHistory", { ...balanceRequest, limit: 200 }, () => api.inventory.getInventoryHistory({ ...balanceRequest, limit: 200 })],
  ["verifyBalanceConsistency", balanceRequest, () => api.inventory.verifyBalanceConsistency(balanceRequest)],
];

it("exposes only the six named Inventory queries and the legacy command bridge", () => {
  expect(Object.keys(api.inventory).sort()).toEqual([
    "execute", ...Object.keys(IPC_CHANNELS.inventory),
  ].sort());
});

it.each(inventoryCases)("forwards %s to its fixed channel and unwraps the result", async (method, input, query) => {
  const data = { onHand: "9223372036854775.807" };
  jest.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, data });
  await expect(query()).resolves.toEqual(data);
  expect(jest.mocked(ipcRenderer.invoke).mock.calls).toEqual([[IPC_CHANNELS.inventory[method], input]]);
});

it("preserves Inventory error codes through ClientError", async () => {
  const error = { code: "AUTH_REQUIRED", message: "تسجيل الدخول مطلوب" };
  jest.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: false, error });
  await expect(api.inventory.getStockBalance(balanceRequest)).rejects.toEqual(new ClientError(error.code, error.message));
});
