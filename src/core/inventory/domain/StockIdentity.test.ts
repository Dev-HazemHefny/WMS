import { InventoryDomainError } from "./InventoryDomainError";
import { StockIdentity } from "./StockIdentity";

const warehouse = { id: "warehouse-1" };
const location = { id: "bin-1", warehouseId: warehouse.id };

describe("StockIdentity", () => {
  it.each(["p:123", "v:123"])("retains the Catalog identity %s and the place", (itemId) => {
    const identity = StockIdentity.create(itemId, location, warehouse);
    expect(identity.itemId).toBe(itemId);
    expect(identity.locationId).toBe(location.id);
    expect(identity.warehouseId).toBe(warehouse.id);
  });

  it.each([
    ["", "bin-1", "warehouse-1", "warehouse-1"],
    ["item-1", "bin-1", "warehouse-1", "warehouse-1"],
    ["v:", "bin-1", "warehouse-1", "warehouse-1"],
    ["p: ", "bin-1", "warehouse-1", "warehouse-1"],
    ["p:item-1", "", "warehouse-1", "warehouse-1"],
    ["v:item-1", "bin-1", " ", "warehouse-1"],
    ["p:item-1", "bin-1", "warehouse-1", ""],
  ])("rejects invalid identifiers (%j, %j, %j, %j)", (item, bin, owner, warehouseId) => {
    const create = () => StockIdentity.create(item, { id: bin, warehouseId: owner }, { id: warehouseId });
    expect(create).toThrow(InventoryDomainError);
    expect(create).toThrow(expect.objectContaining({ code: "INVALID_STOCK_IDENTITY" }));
  });

  it("rejects a location paired with a different warehouse", () => {
    expect(() => StockIdentity.create("v:1", location, { id: "warehouse-2" })).toThrow(
      expect.objectContaining({ code: "LOCATION_WAREHOUSE_MISMATCH" }),
    );
  });

  it("compares by stock item and exact location", () => {
    const identity = StockIdentity.create("p:123", location, warehouse);
    expect(identity.equals(StockIdentity.create("p:123", { ...location }, { ...warehouse }))).toBe(true);
    expect(identity.equals(StockIdentity.create("v:123", location, warehouse))).toBe(false);
    expect(identity.equals(StockIdentity.create("p:123", { ...location, id: "bin-2" }, warehouse))).toBe(false);
  });

  it("is immutable, including after the caller edits the place it supplied", () => {
    const place = { ...location };
    const owner = { ...warehouse };
    const identity = StockIdentity.create("p:123", place, owner);
    place.id = "other-bin";
    owner.id = "other-warehouse";
    expect(Reflect.set(identity, "itemId", "v:123")).toBe(false);
    expect(Reflect.set(identity, "locationId", place.id)).toBe(false);
    expect(Reflect.set(identity, "warehouseId", owner.id)).toBe(false);
    expect(identity.equals(StockIdentity.create("p:123", location, warehouse))).toBe(true);
    expect(identity.warehouseId).toBe(warehouse.id);
  });
});
