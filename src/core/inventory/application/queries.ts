import type { z } from "zod";
import { formatScaledQuantity } from "@shared/catalog/quantity";
import {
  inventoryHistorySchema, stockBalanceSchema, stockItemSchema, warehouseStockSchema,
} from "@shared/inventory/schemas";
import type { StockItemDirectory } from "../../catalog/public";
import { AppError } from "../../shared/errors/app-error";
import type { WarehouseLocationPolicy } from "../../warehouses/public";
import { StockIdentity, summarizeStock, type StockBalance } from "../domain";
import type { InventoryBalanceReader } from "../domain/repositories";
import type { InventoryLedgerReader } from "./ledger-reader";
import type {
  AvailableQuantityResult, BalanceConsistencyResult, InventoryHistoryRequest, InventoryHistoryResult,
  LocationStock, StockBalanceRequest, StockBalanceResult, StockItemRequest, StockItemStockResult,
  WarehouseStockRequest, WarehouseStockResult,
} from "./query-contracts";

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError("بيانات الطلب غير صالحة", "VALIDATION_ERROR");
  return result.data;
}

function mapBalance({ identity, quantity }: StockBalance): LocationStock {
  return {
    itemId: identity.itemId, locationId: identity.locationId, warehouseId: identity.warehouseId,
    onHand: quantity.toDecimalString(),
  };
}

export function createInventoryQueries(deps: {
  catalog: StockItemDirectory;
  warehouses: Pick<WarehouseLocationPolicy, "resolveLocation">;
  balances: Pick<InventoryBalanceReader, "findByIdentity" | "findByStockItem" | "findByWarehouse">;
  ledger: InventoryLedgerReader;
  /** The host resolves the trusted session and enforces read access before invoking work. */
  read: <T>(work: () => T) => T;
}) {
  function requireItem(id: string) {
    const item = deps.catalog.findStockItem(id);
    if (!item) throw new AppError("صنف المخزون غير موجود", "STOCK_ITEM_NOT_FOUND");
    return item;
  }

  function resolveIdentity(input: StockBalanceRequest) {
    const request = parse(stockBalanceSchema, input);
    const { baseUnitId } = requireItem(request.itemId);
    const { location, warehouse } = deps.warehouses.resolveLocation(request.locationId);
    const identity = StockIdentity.create(request.itemId, location, warehouse);
    return { identity, fields: { ...request, warehouseId: warehouse.id, baseUnitId } };
  }

  function readBalance(input: StockBalanceRequest): StockBalanceResult {
    const { identity, fields } = resolveIdentity(input);
    const balance = deps.balances.findByIdentity(identity);
    return { ...fields, onHand: balance?.quantity.toDecimalString() ?? null };
  }

  return {
    getStockBalance(input: StockBalanceRequest): StockBalanceResult {
      return deps.read(() => readBalance(input));
    },
    getAvailableQuantity(input: StockBalanceRequest): AvailableQuantityResult {
      return deps.read(() => {
        const balance = readBalance(input);
        return { ...balance, available: balance.onHand };
      });
    },
    getStockItemStock(input: StockItemRequest): StockItemStockResult {
      return deps.read(() => {
        const { itemId } = parse(stockItemSchema, input);
        const { baseUnitId } = requireItem(itemId);
        const balances = deps.balances.findByStockItem(itemId);
        return { itemId, baseUnitId, onHand: summarizeStock(balances).onHand.toDecimalString(), balances: balances.map(mapBalance) };
      });
    },
    getWarehouseStock(input: WarehouseStockRequest): WarehouseStockResult {
      return deps.read(() => {
        const { warehouseId } = parse(warehouseStockSchema, input);
        const groups = new Map<string, StockBalance[]>();
        for (const balance of deps.balances.findByWarehouse(warehouseId)) {
          const itemId = balance.identity.itemId;
          const group = groups.get(itemId);
          if (group) group.push(balance);
          else groups.set(itemId, [balance]);
        }
        return {
          warehouseId,
          items: Array.from(groups, ([itemId, balances]) => ({
            itemId, onHand: summarizeStock(balances).onHand.toDecimalString(), balances: balances.map(mapBalance),
          })),
        };
      });
    },
    getInventoryHistory(input: InventoryHistoryRequest): InventoryHistoryResult {
      return deps.read(() => {
        const { itemId, locationId, beforeMovementId, limit } = parse(inventoryHistorySchema, input);
        requireItem(itemId);
        if (locationId !== undefined) deps.warehouses.resolveLocation(locationId);
        const page = deps.ledger.listMovements({
          itemId,
          locationId,
          beforeMovementId: beforeMovementId === undefined ? undefined : BigInt(beforeMovementId),
          limit: limit + 1,
        });
        const movements = page.slice(0, limit).map(row => ({
          itemId: row.itemId, locationId: row.locationId, movementId: row.movementId.toString(),
          documentId: row.documentId, delta: formatScaledQuantity(row.delta),
        }));
        return { movements, nextBeforeMovementId: page.length > limit ? movements[limit - 1].movementId : null };
      });
    },
    verifyBalanceConsistency(input: StockBalanceRequest): BalanceConsistencyResult {
      return deps.read(() => {
        const { identity, fields } = resolveIdentity(input);
        const difference = deps.ledger.verifyBalance(identity);
        const discrepancies = difference ? [{
          onHand: difference.onHand === null ? null : formatScaledQuantity(difference.onHand),
          ledger: difference.ledger === null ? null : formatScaledQuantity(difference.ledger),
        }] : [];
        return { ...fields, discrepancies };
      });
    },
  };
}
