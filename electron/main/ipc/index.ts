import {createWarehouseDirectory} from "@core/warehouses/infrastructure/sqlite-directory";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import { app, dialog } from "electron";
import { join } from "node:path";
import { snapshot, stageRestore, activeDirectory, activate } from "../recovery";
import { z } from "zod";
import type Database from "better-sqlite3";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { commands } from "@shared/ipc/stock";
import { createInventory } from "@core/inventory/infrastructure/sqlite-inventory";
import type { Identity } from "@core/identity/application/identity";
import type { CatalogUseCases } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { registerCatalogHandlers } from "./catalog-handlers";
import { bind } from "./dispatch";
export function registerIpcHandlers(
  db: Database.Database,
  catalog: CatalogUseCases,
  identity: Identity,
) {
  const inventory = createInventory(
    db,
    identity.authorize,
    createStockCatalog(db),
    createWarehouseDirectory(db),
    ()=>{const root=app.getPath("userData");snapshot(db,activeDirectory(root),join(root,"backups"))}
  );
  bind(IPC_CHANNELS.system.getAppInfo, z.undefined(), () => ({
    appName: "Warehouse WMS",
    databaseReady: db.open,
  }));
  bind("identity:setup", z.undefined(), () => identity.needsAdmin());
  bind(
    "identity:login",
    z
      .object({
        name: z.string().trim().min(1).max(120),
        password: z.string().min(1).max(256),
        setup: z.boolean(),
      })
      .refine(
        (i) => !i.setup || i.password.length >= 12,
        "استخدم 12 حرفًا على الأقل",
      ),
    (i, w) => identity.login(w, i.name, i.password, i.setup),
  );
  bind(
    "identity:add",
    z.object({
      name: z.string().trim().min(1).max(120),
      password: z.string().min(12).max(256),
      roles: z.array(z.enum(["admin", "clerk", "supervisor"])).min(1),
    }),
    (i, w) => identity.addOperator(w, i.name, i.password, i.roles),
  );
  bind("identity:logout", z.undefined(), (_, w) => identity.end(w));
  bind("inventory:execute", commands, (cmd, w) =>
    inventory(identity.actor(w), cmd),
  );
  for (const action of ["backup", "restore"] as const) {
    bind("recovery:" + action, z.undefined(), async (_, w) => {
      const actor = identity.actor(w);
      identity.authorize(actor, action);
      const folder = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (folder.canceled) return null;
      if (identity.actor(w) !== actor) throw Error("Session changed");
      identity.authorize(actor, action);
      const root = app.getPath("userData"),
        live = activeDirectory(root);
      if (action === "backup") {
        const path=snapshot(db,live,folder.filePaths[0]);
        db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'backup',?)").run(actor,path);
        return path;
      }
      const id = stageRestore(folder.filePaths[0], root);
      snapshot(db, live, join(root, "backups"));
      db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,'restore',?)").run(actor,id);
      activate(root, id);
      app.relaunch();
      app.exit(0);
      return null;
    });
  }
  registerCatalogHandlers(catalog, identity, db);
}
