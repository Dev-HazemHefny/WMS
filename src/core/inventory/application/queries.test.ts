import type { StockItemDirectory } from "../../catalog/public";
import { AppError } from "../../shared/errors/app-error";
import type { WarehouseLocationPolicy } from "../../warehouses/public";
import { Quantity, StockBalance, StockIdentity } from "../domain";
import type { InventoryBalanceReader } from "../domain/repositories";
import type { InventoryLedgerReader } from "./ledger-reader";
import { createInventoryQueries } from "./queries";

const itemId = "p:one";
const request = { itemId, locationId: "bin" };
const fields = { ...request, warehouseId: "warehouse", baseUnitId: "unit" };
const missingLocation = new AppError("Missing location", "LOCATION_NOT_FOUND");

function balance(value: string, locationId = "bin", warehouseId = "warehouse", item = itemId) {
  const identity = StockIdentity.create(item, { id: locationId, warehouseId }, { id: warehouseId });
  return StockBalance.create(identity, Quantity.fromDecimal(value));
}

function setup() {
  const findStockItem = jest.fn<ReturnType<StockItemDirectory["findStockItem"]>, [string]>(
    id => id === itemId ? { baseUnitId: "unit" } : null,
  );
  const resolveLocation = jest.fn<ReturnType<WarehouseLocationPolicy["resolveLocation"]>, [string]>(id => {
    if (id !== request.locationId) throw missingLocation;
    return {
      location: { id, warehouseId: fields.warehouseId },
      warehouse: { id: fields.warehouseId },
    } as ReturnType<WarehouseLocationPolicy["resolveLocation"]>;
  });
  const findByIdentity = jest.fn<ReturnType<InventoryBalanceReader["findByIdentity"]>, [StockIdentity]>(() => null);
  const findByStockItem = jest.fn<ReturnType<InventoryBalanceReader["findByStockItem"]>, [string]>(() => []);
  const findByWarehouse = jest.fn<ReturnType<InventoryBalanceReader["findByWarehouse"]>, [string]>(() => []);
  const listMovements = jest.fn<ReturnType<InventoryLedgerReader["listMovements"]>, Parameters<InventoryLedgerReader["listMovements"]>>(() => []);
  const verifyBalance = jest.fn<ReturnType<InventoryLedgerReader["verifyBalance"]>, Parameters<InventoryLedgerReader["verifyBalance"]>>(() => null);
  const queries = createInventoryQueries({
    catalog: { findStockItem },
    warehouses: { resolveLocation },
    balances: { findByIdentity, findByStockItem, findByWarehouse },
    ledger: { listMovements, verifyBalance },
    read: work => work(),
  });
  return { queries, findByIdentity, findByStockItem, findByWarehouse, findStockItem, resolveLocation, listMovements, verifyBalance };
}

it("reads the exact identity and serializes its quantity to decimal thousandths", () => {
  const { queries, findByIdentity } = setup();
  const stored = balance("1.25");
  findByIdentity.mockReturnValue(stored);
  const result = queries.getStockBalance(request);
  expect(result).toEqual({ ...fields, onHand: "1.250" });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(findByIdentity).toHaveBeenCalledTimes(1);
  expect(findByIdentity).toHaveBeenCalledWith(stored.identity);
});

it("distinguishes an absent balance, unknown item, and unknown location", () => {
  const { queries, findByIdentity } = setup();
  expect(queries.getStockBalance(request)).toEqual({ ...fields, onHand: null });
  expect(() => queries.getStockBalance({ ...request, itemId: "v:unknown" }))
    .toThrow(expect.objectContaining({ code: "STOCK_ITEM_NOT_FOUND" }));
  expect(() => queries.getStockBalance({ ...request, locationId: "unknown" })).toThrow(missingLocation);
  expect(findByIdentity).toHaveBeenCalledTimes(1);
});

it.each([null, [], {}, { ...request, locationId: " " }, { ...request, itemId: "bad" },
  { ...request, itemId: "p: item" }, { ...request, actor: "admin" }])("validates request %p before looking up stock", input => {
  const { queries, findStockItem, findByIdentity } = setup();
  expect(() => queries.getStockBalance(input as typeof request)).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  expect(findStockItem).not.toHaveBeenCalled();
  expect(findByIdentity).not.toHaveBeenCalled();
});

it.each([["0", "0.000"], ["0.005", "0.005"], [null, null]])("reports availability for %p with one balance read", (value, expected) => {
  const { queries, findByIdentity } = setup();
  if (value !== null) findByIdentity.mockReturnValue(balance(value));
  expect(queries.getAvailableQuantity(request)).toEqual({ ...fields, onHand: expected, available: expected });
  expect(findByIdentity).toHaveBeenCalledTimes(1);
});

it("totals only the requested item across locations without per-location lookups", () => {
  const { queries, findByStockItem, findStockItem, resolveLocation } = setup();
  expect(queries.getStockItemStock({ itemId })).toEqual({ itemId, baseUnitId: "unit", onHand: "0.000", balances: [] });
  findByStockItem.mockReturnValueOnce([balance("1.5")]);
  expect(queries.getStockItemStock({ itemId }).onHand).toBe("1.500");
  findByStockItem.mockReturnValueOnce([balance("9007199254740.993"), balance("0.008", "bin-2", "warehouse-2")]);
  expect(queries.getStockItemStock({ itemId })).toEqual({
    itemId, baseUnitId: "unit", onHand: "9007199254741.001",
    balances: [
      { ...request, warehouseId: "warehouse", onHand: "9007199254740.993" },
      { itemId, locationId: "bin-2", warehouseId: "warehouse-2", onHand: "0.008" },
    ],
  });
  expect(findStockItem).toHaveBeenCalledTimes(3);
  expect(findByStockItem.mock.calls).toEqual([[itemId], [itemId], [itemId]]);
  expect(resolveLocation).not.toHaveBeenCalled();
});

it("reports warehouse totals in balance-reader order without per-item reference lookups", () => {
  const { queries, findByWarehouse, findStockItem, resolveLocation } = setup();
  findByWarehouse.mockReturnValue([balance("1"), balance("2.100", "bin-2"), balance("4", "bin", "warehouse", "v:two")]);
  const items = queries.getWarehouseStock({ warehouseId: "warehouse" }).items;
  expect(items.map(({ itemId, onHand, balances }) => [itemId, onHand, balances.map(row => row.locationId)]))
    .toEqual([[itemId, "3.100", ["bin", "bin-2"]], ["v:two", "4.000", ["bin"]]]);
  expect(findByWarehouse).toHaveBeenCalledWith("warehouse");
  expect(findStockItem).not.toHaveBeenCalled();
  expect(resolveLocation).not.toHaveBeenCalled();
});

it.each([{ limit: 0 }, { limit: 201 }, { beforeMovementId: "oops" }, { beforeMovementId: "9223372036854775808" }])(
  "rejects invalid history paging parameters %p", paging => {
    const { queries, listMovements } = setup();
    expect(() => queries.getInventoryHistory({ itemId, ...paging })).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
    expect(listMovements).not.toHaveBeenCalled();
  },
);

it("formats an out-of-range ledger discrepancy exactly", () => {
  const { queries, verifyBalance } = setup();
  verifyBalance.mockReturnValue({ onHand: null, ledger: 9223372036854775808n });
  expect(queries.verifyBalanceConsistency(request)).toEqual({
    ...fields, discrepancies: [{ onHand: null, ledger: "9223372036854775.808" }],
  });
});
