import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { handle } from "./handle";
export function bind<S extends z.ZodTypeAny, R>(
  channel: string,
  schema: S,
  execute: (value: z.output<S>, window: number) => R,
) {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, input: unknown) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !trusted.get(event.sender.id)?.(frame.url)) {
      return {ok:false,error:{code:"UNTRUSTED_SENDER",message:"طلب غير مسموح"}};
    }
    return handle({schema,execute:(parsed:z.output<S>)=>execute(parsed,event.sender.id)})(input);
  });
}
const trusted = new Map<number, (url: string) => boolean>();
export function trustWindow(id: number, test: (url: string) => boolean) {
  trusted.set(id, test);
}
export function forgetWindow(id: number) {
  trusted.delete(id);
}
