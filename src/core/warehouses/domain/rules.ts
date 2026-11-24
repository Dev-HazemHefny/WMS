import type { Branch, Definition, LocationType, LocationUsage, StorageLocation, Warehouse } from "./entities";
import { WarehouseDomainError } from "./errors";

function reject(code: string, message: string): never {
  throw new WarehouseDomainError(code, message);
}

export function normalizeCode(value: string): string {
  const code = value.trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) reject("INVALID_CODE", "رمز التعريف غير صالح");
  return code.toUpperCase();
}

export function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 120) reject("INVALID_NAME", "الاسم مطلوب وبحد أقصى 120 حرفًا");
  return name;
}

const textLimits = { description: 2000, address: 500, contactName: 120, phone: 40 } as const;
export function normalizeOptionalText(value: string | null | undefined, field: keyof typeof textLimits): string | null {
  const text = value?.trim() || null;
  if (text && text.length > textLimits[field]) reject("INVALID_METADATA", "البيانات تتجاوز الطول المسموح");
  return text;
}

/** Call with siblings in the correct uniqueness scope, including inactive rows. */
export function assertCodeAvailable(code: string, definitions: readonly Definition[], currentId?: string): void {
  const normalized = normalizeCode(code);
  if (definitions.some(row => row.id !== currentId && normalizeCode(row.code) === normalized)) {
    reject("DUPLICATE_CODE", "رمز التعريف مستخدم بالفعل");
  }
}

export function assertExpectedVersion(current: Definition, expectedVersion: number): void {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || current.version !== expectedVersion) {
    reject("VERSION_CONFLICT", "تم تعديل البيانات، أعد تحميلها أولًا");
  }
}

export function defaultStockable(type: LocationType): boolean {
  return type === "bin" || type === "other";
}

/** Root-first ancestry including the selected node; iterative, with no depth cap. */
export function locationPath(id: string, locations: readonly StorageLocation[]): StorageLocation[] {
  return createLocationPathResolver(locations)(id);
}

export function createLocationPathResolver(locations: readonly StorageLocation[]): (id: string) => StorageLocation[] {
  const byId = new Map(locations.map(location => [location.id, location]));
  return id => {
    const seen = new Set<string>();
    const path: StorageLocation[] = [];
    let currentId: string | null = id;
    while (currentId !== null) {
      if (seen.has(currentId)) reject("LOCATION_CYCLE", "لا يمكن إنشاء علاقة دائرية بين المواقع");
      const current = byId.get(currentId);
      if (!current) reject("LOCATION_NOT_FOUND", "موقع التخزين غير موجود");
      if (path.length && current.warehouseId !== path[0].warehouseId) {
        reject("PARENT_WAREHOUSE_MISMATCH", "الموقع الأب يجب أن يتبع نفس المخزن");
      }
      seen.add(currentId);
      path.push(current);
      currentId = current.parentId;
    }
    return path.reverse();
  };
}

export function locationSubtree(id: string, locations: readonly StorageLocation[]): StorageLocation[] {
  // Validate ancestry before following children so corrupt imported trees fail closed.
  locationPath(id, locations);
  const children = new Map<string | null, StorageLocation[]>();
  for (const location of locations) {
    const siblings = children.get(location.parentId) ?? [];
    siblings.push(location);
    children.set(location.parentId, siblings);
  }
  const root = locations.find(location => location.id === id)!;
  const pending = [root];
  const result: StorageLocation[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const location = pending.pop()!;
    if (seen.has(location.id)) reject("LOCATION_CYCLE", "لا يمكن إنشاء علاقة دائرية بين المواقع");
    if (location.warehouseId !== root.warehouseId) reject("PARENT_WAREHOUSE_MISMATCH", "الموقع الأب يجب أن يتبع نفس المخزن");
    seen.add(location.id);
    result.push(location);
    pending.push(...(children.get(location.id) ?? []));
  }
  return result;
}

export function assertActiveWarehouse(warehouse: Warehouse, branch: Branch): void {
  if (warehouse.branchId !== branch.id) reject("BRANCH_MISMATCH", "المخزن لا يتبع هذا الفرع");
  if (branch.status !== "active") reject("BRANCH_INACTIVE", "الفرع غير نشط");
  if (warehouse.status !== "active") reject("WAREHOUSE_INACTIVE", "المخزن غير نشط");
}

export function assertActiveLocation(location: StorageLocation, warehouse: Warehouse, branch: Branch, locations: readonly StorageLocation[]): void {
  assertActiveWarehouse(warehouse, branch);
  if (location.warehouseId !== warehouse.id) reject("LOCATION_WAREHOUSE_MISMATCH", "الموقع لا يتبع هذا المخزن");
  // Use the supplied candidate to support validating an activation before saving it.
  const scope = locations.filter(row => row.id !== location.id).concat(location);
  if (locationPath(location.id, scope).some(row => row.status !== "active")) {
    reject("LOCATION_INACTIVE", "الموقع أو أحد المواقع الأب غير نشط");
  }
}

export function assertLocationUsable(location: StorageLocation, warehouse: Warehouse, branch: Branch, locations: readonly StorageLocation[]): void {
  assertActiveLocation(location, warehouse, branch, locations);
  if (!location.isStockable) reject("LOCATION_NOT_STOCKABLE", "الموقع غير مخصص لتخزين الأصناف");
}

/** A stockable parent's count is always for its own ID, never its descendants. */
export function countLocationIds(location: StorageLocation, warehouse: Warehouse, branch: Branch, locations: readonly StorageLocation[]): readonly string[] {
  assertLocationUsable(location, warehouse, branch, locations);
  return [location.id];
}

export function assertDefaultLocation(location: StorageLocation): void {
  if (location.isDefault && (location.parentId !== null || !location.isStockable)) {
    reject("DEFAULT_LOCATION_PROTECTED", "الموقع الافتراضي يجب أن يكون جذرًا قابلًا للتخزين");
  }
}

function assertNoPendingWork(usage: LocationUsage): void {
  if (usage.hasCountLocks) reject("COUNT_ACTIVE", "يوجد جرد مفتوح في النطاق المتأثر");
  if (usage.hasPendingDocuments) reject("PENDING_DOCUMENTS", "توجد مستندات غير معتمدة في النطاق المتأثر");
}

export function assertBranchDeactivation(warehouses: readonly Warehouse[]): void {
  if (warehouses.some(warehouse => warehouse.status === "active")) reject("ACTIVE_CHILDREN", "عطّل المخازن التابعة أولًا");
}

export function assertWarehouseDeactivation(locations: readonly StorageLocation[], usage: LocationUsage): void {
  assertNoPendingWork(usage);
  if (usage.hasPositiveStock) reject("STOCK_EXISTS", "يجب إخلاء المخزن من الأرصدة أولًا");
  if (locations.some(location => !location.isDefault && location.status === "active")) {
    reject("ACTIVE_CHILDREN", "عطّل المواقع التابعة أولًا");
  }
}

export function assertLocationDeactivation(location: StorageLocation, locations: readonly StorageLocation[], usage: LocationUsage): void {
  if (location.isDefault) reject("DEFAULT_LOCATION_PROTECTED", "تُدار حالة الموقع الافتراضي مع المخزن");
  assertNoPendingWork(usage);
  if (usage.hasPositiveStock) reject("STOCK_EXISTS", "يجب إخلاء الموقع من الأرصدة أولًا");
  if (locationSubtree(location.id, locations).some(child => child.id !== location.id && child.status === "active")) {
    reject("ACTIVE_CHILDREN", "عطّل المواقع التابعة أولًا");
  }
}

export function assertStockabilityChange(location: StorageLocation, isStockable: boolean, usage: LocationUsage): void {
  if (location.isStockable === isStockable) return;
  if (location.isDefault) reject("DEFAULT_LOCATION_PROTECTED", "لا يمكن تغيير قابلية تخزين الموقع الافتراضي");
  assertNoPendingWork(usage);
  if (!isStockable && usage.hasPositiveStock) reject("STOCK_EXISTS", "يجب إخلاء الموقع من الأرصدة أولًا");
  if (!isStockable && usage.hasMovements) reject("HISTORY_EXISTS", "الموقع مرتبط بحركات تاريخية");
}

export function assertWarehouseReassignment(warehouse: Warehouse, nextBranch: Branch, usage: LocationUsage): void {
  if (nextBranch.status !== "active") reject("BRANCH_INACTIVE", "الفرع الجديد غير نشط");
  if (warehouse.status !== "inactive") reject("WAREHOUSE_ACTIVE", "عطّل المخزن قبل تغيير الفرع");
  assertNoPendingWork(usage);
  if (usage.hasPositiveStock) reject("STOCK_EXISTS", "يجب إخلاء المخزن من الأرصدة أولًا");
  if (usage.hasMovements) reject("HISTORY_EXISTS", "لا يمكن نقل تبعية مخزن له حركات تاريخية");
}

/** IDs requiring a lock check before structural or descriptive hierarchy changes. */
export function reparentLockScope(location: StorageLocation, parentId: string | null, locations: readonly StorageLocation[]): readonly string[] {
  const subtree = locationSubtree(location.id, locations);
  const oldPath = locationPath(location.id, locations);
  const nextPath = parentId === null ? [] : locationPath(parentId, locations);
  return [...new Set([...subtree, ...oldPath, ...nextPath].map(row => row.id))];
}

export function reparentLocation(location: StorageLocation, parentId: string | null, warehouse: Warehouse, branch: Branch, locations: readonly StorageLocation[], lockedLocationIds: ReadonlySet<string>, updatedAt: string): StorageLocation {
  if (location.isDefault) reject("DEFAULT_LOCATION_PROTECTED", "لا يمكن نقل الموقع الافتراضي");
  const nextPath = parentId === null ? [] : locationPath(parentId, locations);
  if (nextPath.some(parent => parent.id === location.id)) reject("LOCATION_CYCLE", "لا يمكن نقل الموقع إلى أحد أبنائه");
  if (nextPath.some(parent => parent.warehouseId !== location.warehouseId)) {
    reject("PARENT_WAREHOUSE_MISMATCH", "الموقع الأب يجب أن يتبع نفس المخزن");
  }
  const scope = reparentLockScope(location, parentId, locations);
  if (scope.some(id => lockedLocationIds.has(id))) reject("COUNT_ACTIVE", "يوجد جرد مفتوح في النطاق المتأثر");
  // Reparenting changes only descriptive placement, with no stock or history input/output.
  const updated = { ...location, parentId, updatedAt, version: location.version + 1 };
  // Inactive nodes may be reorganized, but their destination ancestors must be active.
  assertActiveLocation({ ...updated, status: "active" }, warehouse, branch, locations);
  return updated;
}
