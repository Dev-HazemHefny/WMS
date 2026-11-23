import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createWarehouseServices } from "../application/create-warehouses";
import type { WarehouseAccess } from "../application/ports";
import type { LocationUsagePolicy } from "../domain/repositories";
import { SqliteBranchRepository, SqliteLocationRepository, SqliteWarehouseRepository } from "./sqlite-repositories";

export interface SqliteWarehouseOptions {
  access: WarehouseAccess;
  /** Inject the Inventory-owned read-only adapter using this same connection. */
  usage: LocationUsagePolicy;
  clock?: { nowIso(): string };
  ids?: { next(): string };
}

export function createSqliteWarehouses(db: Database.Database, options: SqliteWarehouseOptions) {
  return createWarehouseServices({
    branches: new SqliteBranchRepository(db),
    warehouses: new SqliteWarehouseRepository(db),
    locations: new SqliteLocationRepository(db),
    usage: options.usage,
    access: options.access,
    clock: options.clock ?? { nowIso: () => new Date().toISOString() },
    ids: options.ids ?? { next: randomUUID },
    transaction: { run: work => db.transaction(work).immediate() },
    audit: { record: (actor,action,target) => { db.prepare("INSERT INTO audit(actor,action,target) VALUES(?,?,?)").run(actor,action,target); } },
  });
}
