import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { handle } from "./handle";
import { AppError } from "../../../src/core/shared/errors/app-error";
export function bind<S extends z.ZodTypeAny, R>(
  channel: string,
  schema: S,
  execute: (value: z.output<S>, window: number) => R,
) {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, input: unknown) =>
    handle({
      schema,
      execute: (parsed: z.output<S>) => {
        const frame = event.senderFrame;
        if (
          !frame ||
          frame !== event.sender.mainFrame ||
          !trusted.has(event.sender.id) ||
          !trusted.get(event.sender.id)?.(frame.url)
        )
          throw new AppError("طلب غير مسموح", "UNTRUSTED_SENDER");
        return execute(parsed, event.sender.id);
      },
    })(input),
  );
}
const trusted = new Map<number, (url: string) => boolean>();
export function trustWindow(id: number, test: (url: string) => boolean) {
  trusted.set(id, test);
}
export function forgetWindow(id: number) {
  trusted.delete(id);
}
