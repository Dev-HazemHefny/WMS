import type { Branch, StorageLocation, Warehouse } from "../domain/entities";
import { createWarehouseLocationPolicy } from "./location-policy";

const definition = { status: "active", version: 1, createdAt: "", updatedAt: "" } as const;
const branch: Branch = {
  ...definition, id: "branch", code: "BR", name: "Branch",
  description: null, address: null, phone: null, contactName: null,
};
const warehouse: Warehouse = {
  ...definition, id: "warehouse", code: "WH", name: "Warehouse",
  branchId: branch.id, description: null, address: null,
};
const root: StorageLocation = {
  ...definition, id: "root", code: "ROOT", name: "Root", warehouseId: warehouse.id,
  parentId: null, locationType: "other", isDefault: false, isStockable: true,
};
const child: StorageLocation = {
  ...root, id: "child", code: "CHILD", name: "Child", parentId: root.id,
};

function setup({
  definitions = [root, child], selected = child, site = warehouse, owner = branch,
}: {
  definitions?: readonly StorageLocation[];
  selected?: StorageLocation | null;
  site?: Warehouse | null;
  owner?: Branch | null;
} = {}) {
  const listByWarehouse = jest.fn((_id: string) => definitions);
  const policy = createWarehouseLocationPolicy({
    branches: {
      findById: () => owner, findByCode: jest.fn(), findByName: jest.fn(),
      list: jest.fn(), insert: jest.fn(), update: jest.fn(),
    },
    warehouses: {
      findById: () => site, findByCode: jest.fn(), findByName: jest.fn(),
      list: jest.fn(), listByBranch: jest.fn(), insert: jest.fn(), update: jest.fn(),
    },
    locations: {
      findById: () => selected, listByWarehouse, findByCode: jest.fn(),
      findByName: jest.fn(), findDefault: jest.fn(), listChildren: jest.fn(),
      insert: jest.fn(), update: jest.fn(),
    },
  });
  return { policy, listByWarehouse };
}

const eligibilityChecks = {
  receipt: (policy: ReturnType<typeof createWarehouseLocationPolicy>, id: string) => policy.assertLocationUsable(id, "receipt"),
  transfer: (policy: ReturnType<typeof createWarehouseLocationPolicy>, id: string) => policy.assertLocationUsable(id, "transfer"),
  count: (policy: ReturnType<typeof createWarehouseLocationPolicy>, id: string) => policy.countLocationIds(id),
};

test("resolves the root-first path with a single definitions read", () => {
  const { policy, listByWarehouse } = setup();
  expect(policy.resolveLocation(child.id)).toEqual({
    location: child, warehouse, branch, effectiveActive: true,
    path: [{ id: "root", code: "ROOT", name: "Root" }, { id: "child", code: "CHILD", name: "Child" }],
  });
  expect(listByWarehouse.mock.calls).toEqual([[warehouse.id]]);
});

test.each(Object.entries(eligibilityChecks))("%s accepts an active nested stockable location with one read", (_name, check) => {
  const { policy, listByWarehouse } = setup();
  expect(() => check(policy, child.id)).not.toThrow();
  expect(listByWarehouse.mock.calls).toEqual([[warehouse.id]]);
});

test("counting a stockable parent uses exactly its own ID", () => {
  const { policy, listByWarehouse } = setup({ selected: root });
  expect(policy.countLocationIds(root.id)).toEqual([root.id]);
  expect(listByWarehouse.mock.calls).toEqual([[warehouse.id]]);
});

describe.each(Object.entries(eligibilityChecks))("%s rejection", (_name, check) => {
  test.each<[string, Parameters<typeof setup>[0], string, number]>([
    ["missing location", { selected: null, site: null }, "LOCATION_NOT_FOUND", 0],
    ["missing warehouse", { site: null, owner: null }, "WAREHOUSE_NOT_FOUND", 0],
    ["missing branch before ancestry", { owner: null, definitions: [child] }, "BRANCH_NOT_FOUND", 0],
    ["missing ancestor before inactive branch", { definitions: [child], owner: { ...branch, status: "inactive" } }, "LOCATION_NOT_FOUND", 1],
    ["cycle", { definitions: [{ ...root, parentId: child.id }, child] }, "LOCATION_CYCLE", 1],
    ["ancestor in another warehouse", { definitions: [{ ...root, warehouseId: "other" }, child] }, "PARENT_WAREHOUSE_MISMATCH", 1],
    ["warehouse/branch mismatch before inactivity", { owner: { ...branch, id: "other", status: "inactive" } }, "BRANCH_MISMATCH", 1],
    ["inactive branch before inactive warehouse", { owner: { ...branch, status: "inactive" }, site: { ...warehouse, status: "inactive" } }, "BRANCH_INACTIVE", 1],
    ["inactive warehouse before membership", { site: { ...warehouse, id: "other", status: "inactive" } }, "WAREHOUSE_INACTIVE", 1],
    ["location/warehouse mismatch", { site: { ...warehouse, id: "other" } }, "LOCATION_WAREHOUSE_MISMATCH", 1],
    ["inactive location before stockability", { selected: { ...child, status: "inactive", isStockable: false } }, "LOCATION_INACTIVE", 1],
    ["inactive ancestor", { definitions: [{ ...root, status: "inactive" }, child] }, "LOCATION_INACTIVE", 1],
    ["non-stockable location", { selected: { ...child, isStockable: false } }, "LOCATION_NOT_STOCKABLE", 1],
  ])("preserves the error for %s", (_scenario, input, code, reads) => {
    const { policy, listByWarehouse } = setup(input);
    expect(() => check(policy, child.id)).toThrow(expect.objectContaining({ code }));
    expect(listByWarehouse).toHaveBeenCalledTimes(reads);
  });
});

test("historical reporting includes inactive stockable locations and resolves their path", () => {
  const inactive = { ...root, status: "inactive" } as const;
  const { policy } = setup({ definitions: [inactive, child] });
  expect(policy.listInventoryLocationIds(warehouse.id)).toEqual([root.id, child.id]);
  expect(policy.resolveLocation(child.id)).toMatchObject({
    effectiveActive: false, path: [{ id: root.id }, { id: child.id }],
  });
  expect(policy.listStockableLocations(warehouse.id)).toEqual([]);
});

test("separate operations read the latest definitions", () => {
  const { policy, listByWarehouse } = setup();
  expect(() => policy.assertLocationUsable(child.id, "receipt")).not.toThrow();
  listByWarehouse.mockReturnValue([{ ...root, status: "inactive" }, child]);
  expect(() => policy.assertLocationUsable(child.id, "receipt")).toThrow(expect.objectContaining({ code: "LOCATION_INACTIVE" }));
  expect(listByWarehouse.mock.calls).toEqual([[warehouse.id], [warehouse.id]]);
});
