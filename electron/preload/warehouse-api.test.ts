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
