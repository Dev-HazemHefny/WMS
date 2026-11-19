import { ipcMain } from "electron";
import { z } from "zod";
import { handle } from "@core/shared/ipc/handle";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { getDatabase } from "../database";
import { registerCatalogHandlers } from "./catalog-handlers";
import { createLogger } from "../logger";

const logger = createLogger("ipc");

export function registerIpcHandlers(userDataPath: string): void {
  ipcMain.handle(
    IPC_CHANNELS.system.getAppInfo,
    (_event, input: unknown) =>
      handle({
        schema: z.undefined(),
        execute: () => ({
          appName: "Warehouse WMS",
          databaseReady: getDatabase().open
        })
      })(input)
  );

  registerCatalogHandlers(userDataPath);
  logger.info("IPC handlers registered");
}