import { createInventoryWarehouseGateway } from "@core/warehouses/infrastructure/create-inventory-gateway";
import { createSqliteLocationUsage } from "@core/inventory/infrastructure/sqlite-location-usage";
import { createStockCatalog } from "@core/catalog/infrastructure/stock-catalog";
import { app } from "electron";
import { join } from "node:path";
import { snapshot, activeDirectory } from "../recovery";
import { z } from "zod";
import type Database from "better-sqlite3";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import { commands } from "@shared/ipc/stock";
import { createInventory } from "@core/inventory/infrastructure/sqlite-inventory";
import type { Identity } from "@core/identity/application/identity";
import type { CatalogUseCases } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { registerCatalogHandlers } from "./catalog-handlers";
import { bind } from "./dispatch";
import { registerWarehouseHandlers } from "./warehouse-handlers";
import { createSqliteWarehouses } from "@core/warehouses/infrastructure/create-sqlite-warehouses";
import { registerIdentityHandlers } from "./identity-handlers";
import { registerRecoveryHandlers } from "./recovery-handlers";

export function registerIpcHandlers(
  db: Database.Database,
  catalog: CatalogUseCases,
  identity: Identity,
) {
  const usage = createSqliteLocationUsage(db);
  registerWarehouseHandlers(
    (windowId) => createSqliteWarehouses(db, {
      usage,
      access: {
        currentActor: () => identity.actor(windowId),
        authorize: identity.authorize,
      },
    }),
    identity.capabilities,
  );
  const inventory = createInventory(
    db,
    identity.authorize,
    createStockCatalog(db),
    createInventoryWarehouseGateway(db, identity.authorize, usage),
    () => {
      const root = app.getPath("userData");
      snapshot(db, activeDirectory(root), join(root, "backups"));
    },
  );
  bind(IPC_CHANNELS.system.getAppInfo, z.undefined(), () => ({
    appName: "Warehouse WMS",
    databaseReady: db.open,
  }));
  registerIdentityHandlers(identity);
  bind("inventory:execute", commands, (cmd, w) =>
    inventory(identity.actor(w), cmd),
  );
  registerRecoveryHandlers(db, identity);
  registerCatalogHandlers(catalog, identity, db);
}
