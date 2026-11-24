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
import { createSqliteInventoryQueries } from "@core/inventory/infrastructure/create-sqlite-inventory-queries";
import type { Identity } from "@core/identity/public";
import type { CatalogUseCases } from "@core/catalog/infrastructure/create-sqlite-catalog";
import { registerCatalogHandlers } from "./catalog-handlers";
import { registerScope } from "./dispatch";
import { registerWarehouseHandlers } from "./warehouse-handlers";
import { createSqliteWarehouses } from "@core/warehouses/infrastructure/create-sqlite-warehouses";
import { registerIdentityHandlers } from "./identity-handlers";
import { registerRecoveryHandlers } from "./recovery-handlers";
import { registerInventoryHandlers } from "./inventory-handlers";

export function registerIpcHandlers(
  db: Database.Database,
  catalog: CatalogUseCases,
  identity: Identity,
) {
  return registerScope(({ bind, own }) => {
    const usage = createSqliteLocationUsage(db);
    const stockCatalog = createStockCatalog(db);
    const warehouseGateway = createInventoryWarehouseGateway(db, identity.authorize, usage);
    own(registerWarehouseHandlers(
      (windowId) => createSqliteWarehouses(db, {
        usage,
        access: {
          currentActor: () => identity.actor(windowId),
          authorize: identity.authorize,
        },
      }),
      identity.capabilities,
    ));
    const inventory = createInventory(
      db,
      identity.authorize,
      stockCatalog,
      warehouseGateway,
      () => {
        const root = app.getPath("userData");
        snapshot(db, activeDirectory(root), join(root, "backups"));
      },
    );
    bind(IPC_CHANNELS.system.getAppInfo, z.undefined(), () => ({
      appName: "Warehouse WMS",
      databaseReady: db.open,
    }));
    own(registerIdentityHandlers(identity));
    bind("inventory:execute", commands, (cmd, w) =>
      inventory(identity.actor(w), cmd),
    );
    own(registerRecoveryHandlers(db, identity));
    own(registerCatalogHandlers(catalog, identity, db));
    own(registerInventoryHandlers(windowId => createSqliteInventoryQueries(
      db,
      { currentActor: () => identity.actor(windowId), authorize: identity.authorize },
      stockCatalog,
      warehouseGateway,
    )));
  });
}
