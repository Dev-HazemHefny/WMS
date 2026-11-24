import type Database from "better-sqlite3";
import { AppError } from "../../shared/errors/app-error";
import type { InventoryLedgerReader, MovementQuery } from "../application/ledger-reader";
import type { StockBalanceRequest } from "../application/query-contracts";

interface Movement {
  movementId: bigint;
  documentId: string;
  itemId: string;
  locationId: string;
  delta: bigint;
  snapshot: string;
}

interface Discrepancy extends StockBalanceRequest {
  onHand: bigint | null;
  ledger: bigint | null;
}

function integer(value: unknown): bigint {
  if (typeof value !== "bigint") throw new AppError("بيانات سجل المخزون غير صالحة", "INVALID_LEDGER");
  return value;
}

/** Shared by application reads and the legacy commands on the caller's connection. */
export function createSqliteInventoryLedger(db: Database.Database) {
  function listMovements({ itemId, locationId, beforeMovementId, limit }: MovementQuery): Movement[] {
    const clauses = ["item = ?"];
    const params: (string | number | bigint)[] = [itemId];
    if (locationId !== undefined) {
      clauses.push("location = ?");
      params.push(locationId);
    }
    if (beforeMovementId !== undefined) {
      clauses.push("id < ?");
      params.push(beforeMovementId);
    }
    return db.prepare<typeof params, Movement>(`
      SELECT id AS movementId, document AS documentId, item AS itemId, location AS locationId, delta, snapshot
      FROM movements WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?
    `).safeIntegers().all(...params, limit).map(row => ({ ...row, delta: integer(row.delta) }));
  }

  function ledgerTotals(identity?: StockBalanceRequest) {
    const where = identity ? "WHERE item=? AND location=?" : "";
    const params = identity ? [identity.itemId, identity.locationId] : [];
    const totals = new Map<string, { itemId: string; locationId: string; ledger: bigint }>();
    for (const row of db.prepare<string[], { item: string; location: string; delta: unknown }>(
      `SELECT item, location, delta FROM movements ${where}`,
    ).safeIntegers().iterate(...params)) {
      const key = JSON.stringify([row.item, row.location]);
      const ledger = (totals.get(key)?.ledger ?? 0n) + integer(row.delta);
      totals.set(key, { itemId: row.item, locationId: row.location, ledger });
    }
    return totals;
  }

  function findDiscrepancies(identity?: StockBalanceRequest): Discrepancy[] {
    const totals = ledgerTotals(identity);
    const where = identity ? "WHERE item=? AND location=?" : "";
    const params = identity ? [identity.itemId, identity.locationId] : [];
    const differences: Discrepancy[] = [];
    for (const row of db.prepare<string[], { item: string; location: string; qty: unknown }>(
      `SELECT item, location, qty FROM balances ${where}`,
    ).safeIntegers().iterate(...params)) {
      const key = JSON.stringify([row.item, row.location]);
      const ledger = totals.get(key)?.ledger ?? null;
      const onHand = integer(row.qty);
      if (onHand !== ledger) differences.push({ itemId: row.item, locationId: row.location, onHand, ledger });
      totals.delete(key);
    }
    for (const row of totals.values()) differences.push({ ...row, onHand: null });
    return differences.sort((a, b) => {
      if (a.itemId !== b.itemId) return a.itemId < b.itemId ? -1 : 1;
      if (a.locationId === b.locationId) return 0;
      return a.locationId < b.locationId ? -1 : 1;
    });
  }

  const reader = {
    listMovements,
    verifyBalance(identity) {
      return findDiscrepancies(identity)[0] ?? null;
    },
  } satisfies InventoryLedgerReader;
  return { ...reader, ledgerTotals, findDiscrepancies };
}
