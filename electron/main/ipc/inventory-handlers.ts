import type { WebContents } from "electron";
import type { z } from "zod";
import type { createSqliteInventoryQueries } from "@core/inventory/infrastructure/create-sqlite-inventory-queries";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type { InventoryQueryApi } from "@shared/ipc/contracts";
import {
  inventoryHistorySchema,
  stockBalanceSchema,
  stockItemSchema,
  warehouseStockSchema,
} from "@shared/inventory/schemas";
import { registerScope } from "./dispatch";

type Queries = ReturnType<typeof createSqliteInventoryQueries>;

export function registerInventoryHandlers(createQueries: (windowId: number) => Queries) {
  return registerScope(({ bind }) => {
    const queriesByWindow = new WeakMap<WebContents, Queries>();

    function register<Method extends keyof InventoryQueryApi>(
      method: Method,
      schema: z.ZodType<Parameters<InventoryQueryApi[Method]>[0], z.ZodTypeDef, unknown>,
      execute: (
        queries: Queries,
        input: Parameters<InventoryQueryApi[Method]>[0],
      ) => Awaited<ReturnType<InventoryQueryApi[Method]>>,
    ) {
      bind(IPC_CHANNELS.inventory[method], schema, (input, windowId, sender) => {
        let queries = queriesByWindow.get(sender);
        if (!queries) {
          queries = createQueries(windowId);
          queriesByWindow.set(sender, queries);
        }
        return execute(queries, input);
      }, issues => {
        if (method === "getInventoryHistory" && issues.every(({ path }) =>
          path[0] === "limit" || path[0] === "beforeMovementId",
        )) {
          return { code: "INVALID_HISTORY_PAGINATION", message: "بيانات صفحة سجل المخزون غير صالحة" };
        }
        return { code: "VALIDATION_ERROR", message: "بيانات الطلب غير صالحة" };
      });
    }

    register("getStockBalance", stockBalanceSchema, (queries, input) => queries.getStockBalance(input));
    register("getStockItemStock", stockItemSchema, (queries, input) => queries.getStockItemStock(input));
    register("getWarehouseStock", warehouseStockSchema, (queries, input) => queries.getWarehouseStock(input));
    register("getAvailableQuantity", stockBalanceSchema, (queries, input) => queries.getAvailableQuantity(input));
    register("getInventoryHistory", inventoryHistorySchema, (queries, input) => queries.getInventoryHistory(input));
    register("verifyBalanceConsistency", stockBalanceSchema, (queries, input) => queries.verifyBalanceConsistency(input));
  });
}
