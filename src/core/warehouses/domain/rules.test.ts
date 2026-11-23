import type { Branch, LocationUsage, StorageLocation, Warehouse } from "./entities";
import {
  assertActiveLocation, assertActiveWarehouse, assertBranchDeactivation,
  assertCodeAvailable, assertDefaultLocation, assertExpectedVersion,
  assertLocationDeactivation, assertLocationUsable, assertStockabilityChange,
  assertWarehouseDeactivation, assertWarehouseReassignment, countLocationIds,
  defaultStockable, locationPath, locationSubtree, normalizeCode, normalizeName,
  normalizeOptionalText, reparentLocation, reparentLockScope,
} from "./rules";

const metadata = { code: "TEST", name: "اختبار", status: "active" as const, createdAt: "2026-11-22", updatedAt: "2026-11-22", version: 1 };
const branch: Branch = { ...metadata, id: "branch", description: null, address: null, phone: null, contactName: null };
const warehouse: Warehouse = { ...metadata, id: "warehouse", branchId: branch.id, description: null, address: null };
const empty: LocationUsage = { hasPositiveStock: false, hasMovements: false, hasPendingDocuments: false, hasCountLocks: false };
function location(id: string, parentId: string | null = null, changes: Partial<StorageLocation> = {}): StorageLocation {
  return { ...metadata, id, code: id.toUpperCase(), warehouseId: warehouse.id, parentId, locationType: "bin", isStockable: true, isDefault: false, ...changes };
}
const root = location("root");
const child = location("child", root.id);
const target = location("target");
const locations = [root, child, target];
const expectCode = (action: () => unknown, code: string) => expect(action).toThrow(expect.objectContaining({ code }));

describe("warehouse definition validation", () => {
  it("normalizes codes and Arabic names without accepting invalid codes", () => {
    expect(normalizeCode(" wh-01_a ")).toBe("WH-01_A");
    expect(normalizeName(" فرع القاهرة ")).toBe("فرع القاهرة");
    for (const code of ["", "أ", "ß", "A B", "A/1", "A".repeat(33)]) expectCode(() => normalizeCode(code), "INVALID_CODE");
    expectCode(() => normalizeName(" "), "INVALID_NAME");
    expectCode(() => normalizeName("a".repeat(121)), "INVALID_NAME");
  });
  it("enforces optional metadata lengths and normalizes blanks", () => {
    expect(normalizeOptionalText("  ", "description")).toBeNull();
    expect(normalizeOptionalText(" 0123 ", "phone")).toBe("0123");
    for (const [field, limit] of [["description",2000],["address",500],["contactName",120],["phone",40]] as const) {
      expect(normalizeOptionalText("a".repeat(limit), field)).toHaveLength(limit);
      expectCode(() => normalizeOptionalText("a".repeat(limit+1), field), "INVALID_METADATA");
    }
  });
  it("checks code uniqueness across inactive definitions but permits editing the same ID", () => {
    const existing = { ...branch, code: "BR-1", status: "inactive" as const };
    expectCode(() => assertCodeAvailable("br-1", [existing]), "DUPLICATE_CODE");
    expect(() => assertCodeAvailable("BR-1", [existing], branch.id)).not.toThrow();
  });
  it("rejects stale or invalid expected versions", () => {
    expect(() => assertExpectedVersion(branch, 1)).not.toThrow();
    for (const version of [0, 2, 1.5, Number.NaN]) expectCode(() => assertExpectedVersion(branch, version), "VERSION_CONFLICT");
  });
  it("uses type defaults without preventing explicitly stockable organizational levels", () => {
    expect([defaultStockable("zone"),defaultStockable("shelf"),defaultStockable("bin"),defaultStockable("other")]).toEqual([false,false,true,true]);
    expect(() => assertLocationUsable({ ...root, locationType: "zone" },warehouse,branch,locations)).not.toThrow();
  });
});

describe("location hierarchy and exact-location counts", () => {
  it("builds root-first paths and traverses subtrees without a depth cap", () => {
    const deep = Array.from({length:2000}, (_,i) => location(String(i),i ? String(i-1) : null));
    expect(locationPath("1999",deep)).toHaveLength(2000);
    expect(locationSubtree("0",deep)).toHaveLength(2000);
    expect(locationPath(child.id,locations).map(row=>row.id)).toEqual([root.id,child.id]);
  });
  it("rejects missing parents, cycles and wrong-warehouse ancestry", () => {
    expectCode(() => locationPath("missing",locations), "LOCATION_NOT_FOUND");
    expectCode(() => locationPath(root.id,[{...root,parentId:child.id},child]), "LOCATION_CYCLE");
    expectCode(() => locationPath(child.id,[{...root,warehouseId:"other"},child]), "PARENT_WAREHOUSE_MISMATCH");
  });
  it("counts only a selected stockable parent, leaving children out of scope", () => {
    expect(countLocationIds(root,warehouse,branch,locations)).toEqual([root.id]);
    expect(countLocationIds(child,warehouse,branch,locations)).toEqual([child.id]);
    expect(countLocationIds(root,warehouse,branch,locations)).not.toContain(child.id);
  });
  it("rejects non-stockable and inactive count targets", () => {
    expectCode(() => countLocationIds({...root,isStockable:false},warehouse,branch,locations), "LOCATION_NOT_STOCKABLE");
    expectCode(() => countLocationIds({...root,status:"inactive"},warehouse,branch,locations), "LOCATION_INACTIVE");
  });
  it("requires an active owning branch, warehouse, location and ancestor chain", () => {
    expectCode(() => assertActiveWarehouse(warehouse,{...branch,id:"wrong"}), "BRANCH_MISMATCH");
    expectCode(() => assertActiveWarehouse(warehouse,{...branch,status:"inactive"}), "BRANCH_INACTIVE");
    expectCode(() => assertActiveWarehouse({...warehouse,status:"inactive"},branch), "WAREHOUSE_INACTIVE");
    expectCode(() => assertActiveLocation(child,warehouse,branch,[{...root,status:"inactive"},child]), "LOCATION_INACTIVE");
    expectCode(() => assertActiveLocation({...root,warehouseId:"other"},warehouse,branch,locations), "LOCATION_WAREHOUSE_MISMATCH");
    expect(() => assertActiveLocation({...child,status:"active"},warehouse,branch,[root,{...child,status:"inactive"}])).not.toThrow();
  });
  it("protects a default stockable root", () => {
    expect(() => assertDefaultLocation({...root,isDefault:true})).not.toThrow();
    expectCode(() => assertDefaultLocation({...child,isDefault:true}), "DEFAULT_LOCATION_PROTECTED");
    expectCode(() => assertDefaultLocation({...root,isDefault:true,isStockable:false}), "DEFAULT_LOCATION_PROTECTED");
  });
  it("reparents a stocked location by changing only its parent and edit metadata", () => {
    const stocked = Object.freeze({...root});
    const before = JSON.stringify(locations);
    const updated = reparentLocation(stocked,target.id,warehouse,branch,locations,new Set(),"later");
    expect(updated).toEqual({...stocked,parentId:target.id,version:2,updatedAt:"later"});
    expect(updated.id).toBe(stocked.id);
    expect(updated.warehouseId).toBe(stocked.warehouseId);
    expect(JSON.stringify(locations)).toBe(before);
    // This pure transformation cannot write balances, documents or movement history.
    // Persistence-level stock/history comparisons are a mandatory Stage 4/5 gate.
  });
  it("rejects self/descendant moves, cross-warehouse moves and inactive destinations", () => {
    for (const parentId of [root.id,child.id]) expectCode(() => reparentLocation(root,parentId,warehouse,branch,locations,new Set(),"later"), "LOCATION_CYCLE");
    expectCode(() => reparentLocation(root,target.id,warehouse,branch,[root,child,{...target,warehouseId:"other"}],new Set(),"later"), "PARENT_WAREHOUSE_MISMATCH");
    expectCode(() => reparentLocation(root,target.id,warehouse,branch,[root,child,{...target,status:"inactive"}],new Set(),"later"), "LOCATION_INACTIVE");
    expectCode(() => reparentLocation({...root,isDefault:true},target.id,warehouse,branch,locations,new Set(),"later"), "DEFAULT_LOCATION_PROTECTED");
  });
  it("checks moved descendants, old ancestors and new ancestors for active count locks", () => {
    const oldRoot=location("old"),nextRoot=location("next");
    const moved={...root,parentId:oldRoot.id},dest={...target,parentId:nextRoot.id};
    const all=[moved,child,dest,oldRoot,nextRoot];
    expect(new Set(reparentLockScope(moved,dest.id,all))).toEqual(new Set([moved.id,child.id,dest.id,oldRoot.id,nextRoot.id]));
    for(const id of [moved.id,child.id,dest.id,oldRoot.id,nextRoot.id]) {
      expectCode(()=>reparentLocation(moved,dest.id,warehouse,branch,all,new Set([id]),"later"),"COUNT_ACTIVE");
    }
    expect(()=>reparentLocation(moved,null,warehouse,branch,all,new Set(["unrelated"]),"later")).not.toThrow();
  });
});

describe("definition lifecycle policies", () => {
  it("requires child warehouses to be inactive before deactivating a branch", () => {
    expectCode(()=>assertBranchDeactivation([warehouse]),"ACTIVE_CHILDREN");
    expect(()=>assertBranchDeactivation([{...warehouse,status:"inactive"}])).not.toThrow();
  });
  it("allows warehouse history but blocks stock, pending work, counts and active non-default locations", () => {
    const defaultLocation={...root,isDefault:true};
    expect(()=>assertWarehouseDeactivation([defaultLocation],{...empty,hasMovements:true})).not.toThrow();
    expectCode(()=>assertWarehouseDeactivation([root],empty),"ACTIVE_CHILDREN");
    for(const [field,code] of [["hasPositiveStock","STOCK_EXISTS"],["hasPendingDocuments","PENDING_DOCUMENTS"],["hasCountLocks","COUNT_ACTIVE"]] as const) {
      expectCode(()=>assertWarehouseDeactivation([defaultLocation],{...empty,[field]:true}),code);
    }
  });
  it("requires a location's whole subtree to be empty, unlocked and inactive below it", () => {
    expectCode(()=>assertLocationDeactivation(root,locations,empty),"ACTIVE_CHILDREN");
    const inactiveChildren=[root,{...child,status:"inactive" as const},target];
    expect(()=>assertLocationDeactivation(root,inactiveChildren,{...empty,hasMovements:true})).not.toThrow();
    for(const [field,code] of [["hasPositiveStock","STOCK_EXISTS"],["hasPendingDocuments","PENDING_DOCUMENTS"],["hasCountLocks","COUNT_ACTIVE"]] as const) {
      expectCode(()=>assertLocationDeactivation(root,inactiveChildren,{...empty,[field]:true}),code);
    }
    expectCode(()=>assertLocationDeactivation({...root,isDefault:true},locations,empty),"DEFAULT_LOCATION_PROTECTED");
  });
  it("protects stockable defaults and prevents reinterpreting a location with stock or history", () => {
    expect(()=>assertStockabilityChange(root,false,empty)).not.toThrow();
    for(const [field,code] of [["hasPositiveStock","STOCK_EXISTS"],["hasMovements","HISTORY_EXISTS"],["hasPendingDocuments","PENDING_DOCUMENTS"],["hasCountLocks","COUNT_ACTIVE"]] as const) {
      expectCode(()=>assertStockabilityChange(root,false,{...empty,[field]:true}),code);
    }
    expectCode(()=>assertStockabilityChange({...root,isDefault:true},false,empty),"DEFAULT_LOCATION_PROTECTED");
  });
  it("permits branch reassignment only for an inactive unused warehouse and active destination", () => {
    const inactive={...warehouse,status:"inactive" as const};
    expect(()=>assertWarehouseReassignment(inactive,branch,empty)).not.toThrow();
    expectCode(()=>assertWarehouseReassignment(warehouse,branch,empty),"WAREHOUSE_ACTIVE");
    expectCode(()=>assertWarehouseReassignment(inactive,{...branch,status:"inactive"},empty),"BRANCH_INACTIVE");
    for(const [field,code] of [["hasPositiveStock","STOCK_EXISTS"],["hasMovements","HISTORY_EXISTS"],["hasPendingDocuments","PENDING_DOCUMENTS"],["hasCountLocks","COUNT_ACTIVE"]] as const) {
      expectCode(()=>assertWarehouseReassignment(inactive,branch,{...empty,[field]:true}),code);
    }
  });
});
