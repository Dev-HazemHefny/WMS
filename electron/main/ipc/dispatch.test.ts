import { expect, it, jest } from "@jest/globals";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { bind, forgetWindow, registerScope, trustWindow } from "./dispatch";
import { handle } from "./handle";
jest.mock("electron",()=>({ipcMain:{handle:jest.fn(),removeHandler:jest.fn()}}));
it("dispatches only validated input from a registered main frame and revokes destroyed windows",async()=>{
  const frame={url:"file:///test/index.html"};
  const event={sender:{id:42,mainFrame:frame},senderFrame:frame};
  const execute=jest.fn((n:number)=>n+1);
  bind("test:count",z.number().int(),execute);
  const handler=jest.mocked(ipcMain.handle).mock.calls[0][1];
  const invoke=(e:typeof event,input:unknown)=>handler(e as unknown as IpcMainInvokeEvent,input);
  const denied={ok:false,error:expect.objectContaining({code:"UNTRUSTED_SENDER"})};
  await expect(invoke(event,1)).resolves.toMatchObject(denied);
  trustWindow(42,url=>url===frame.url);
  try{
    await expect(invoke({...event,senderFrame:{...frame}},1)).resolves.toMatchObject(denied);
    const other={url:"file:///test/other.html"};
    await expect(invoke({sender:{id:42,mainFrame:other},senderFrame:other},1)).resolves.toMatchObject(denied);
    await expect(invoke(event,"one")).resolves.toMatchObject({ok:false,error:{code:"VALIDATION_ERROR"}});
    expect(execute).not.toHaveBeenCalled();
    await expect(invoke(event,1)).resolves.toEqual({ok:true,data:2});
  }finally{forgetWindow(42)}
  await expect(invoke(event,1)).resolves.toMatchObject(denied);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("passes transformed schema output to the handler and checks trust before parsing", async () => {
  const frame = { url: "file:///test/index.html" };
  const event = { sender: { id: 43, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const transform = jest.fn((value: string) => value.length);
  const execute = jest.fn((length: number) => length + 1);
  const dispose = bind("test:length", z.string().min(1).transform(transform), execute);
  const handler = jest.mocked(ipcMain.handle).mock.lastCall![1];

  try {
    await expect(handler(event, "abc")).resolves.toMatchObject({ ok: false, error: { code: "UNTRUSTED_SENDER" } });
    expect(transform).not.toHaveBeenCalled();
    trustWindow(43, url => url === frame.url);
    await expect(handler(event, "")).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(execute).not.toHaveBeenCalled();
    await expect(handler(event, "abc")).resolves.toEqual({ ok: true, data: 4 });
    expect(execute).toHaveBeenCalledWith(3, 43, event.sender);
  } finally {
    dispose();
    forgetWindow(43);
  }
});

it("types the validation executor from the schema output", async () => {
  const schema = z.string().transform(value => value.length);
  const validate = handle({ schema, execute: length => length.toFixed(1) });
  await expect(validate("abc")).resolves.toEqual({ ok: true, data: "3.0" });
  // @ts-expect-error The executor receives a number from the schema, not the raw string.
  handle({ schema, execute: (raw: string) => raw.trim() });
});

it("sanitizes unexpected failures raised while parsing", async () => {
  const schema = z.string().transform(() => {
    throw new Error("SELECT * FROM warehouse.sqlite at C:/private/profile secret-token");
  });
  const execute = jest.fn();
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(handle({ schema, execute })("abc")).resolves.toEqual({
      ok: false, error: { code: "INTERNAL_ERROR", message: "حدث خطأ غير متوقع" },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
  } finally {
    log.mockRestore();
  }
});

it("attempts all owned cleanup actions and reports registration and cleanup failures", () => {
  const registrationFailure = new Error("Cannot register channel");
  const cleanupFailure = new Error("Cannot remove channel");
  const remove = jest.mocked(ipcMain.removeHandler);
  jest.mocked(ipcMain.handle).mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    .mockImplementationOnce(() => { throw registrationFailure; });
  remove.mockClear().mockImplementationOnce(() => { throw cleanupFailure; });

  expect(() => registerScope(({ bind }) => {
    bind("test:first", z.undefined(), () => null);
    bind("test:second", z.undefined(), () => null);
    bind("test:collision", z.undefined(), () => null);
  })).toThrow(expect.objectContaining({
    errors: [registrationFailure, expect.objectContaining({ errors: [cleanupFailure] })],
  }));
  expect(remove.mock.calls.flat()).toEqual(["test:second", "test:first"]);
});

it("rejects a previously captured handler after disposal even with a trusted sender", async () => {
  const frame = { url: "file:///test/index.html" };
  const event = { sender: { id: 44, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const execute = jest.fn();
  const dispose = bind("test:disposed", z.undefined(), execute);
  const handler = jest.mocked(ipcMain.handle).mock.lastCall![1];
  trustWindow(44, url => url === frame.url);
  try {
    dispose();
    await expect(handler(event)).resolves.toMatchObject({ ok: false, error: { code: "UNTRUSTED_SENDER" } });
    expect(execute).not.toHaveBeenCalled();
  } finally {
    forgetWindow(44);
  }
});
