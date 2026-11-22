import { expect, it, jest } from "@jest/globals";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { bind, forgetWindow, trustWindow } from "./dispatch";
jest.mock("electron",()=>({ipcMain:{handle:jest.fn()}}));
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
