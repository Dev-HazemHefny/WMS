import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import type { ZodType, ZodTypeDef } from "zod";
import { handle, type ValidationErrorMapper } from "./handle";

export function bind<Parsed, Raw, R>(
  channel: string,
  schema: ZodType<Parsed, ZodTypeDef, Raw>,
  execute: (value: NoInfer<Parsed>, window: number, sender: WebContents) => R,
  validationError?: ValidationErrorMapper,
) {
  let registered = true;
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, input: unknown) => {
    const frame = registered ? event.senderFrame : null;
    if (!frame || frame !== event.sender.mainFrame || !trusted.get(event.sender.id)?.(frame.url)) {
      return {ok:false,error:{code:"UNTRUSTED_SENDER",message:"طلب غير مسموح"}};
    }
    return handle({
      schema,
      execute: parsed => execute(parsed, event.sender.id, event.sender),
      validationError,
    })(input);
  });
  return () => {
    if (!registered) return;
    registered = false;
    ipcMain.removeHandler(channel);
  };
}

type Disposer = () => void;
type RegistrationScope = {
  bind: <Parsed, Raw, R>(...args: Parameters<typeof bind<Parsed, Raw, R>>) => void;
  own: (dispose: Disposer) => void;
};

export function registerScope(register: (scope: RegistrationScope) => void): Disposer {
  const disposers: Disposer[] = [];
  const dispose = () => {
    const errors: unknown[] = [];
    for (const unregister of disposers.splice(0).reverse()) {
      try {
        unregister();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "IPC cleanup failed");
  };
  const own = (unregister: Disposer) => { disposers.push(unregister); };
  try {
    register({ bind: (...args) => own(bind(...args)), own });
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "IPC registration and cleanup failed");
    }
    throw error;
  }
  return dispose;
}

const trusted = new Map<number, (url: string) => boolean>();
export function trustWindow(id: number, test: (url: string) => boolean) {
  trusted.set(id, test);
}
export function forgetWindow(id: number) {
  trusted.delete(id);
}
