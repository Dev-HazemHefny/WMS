import type { Branch, Definition, DefinitionStatus, LocationType, StorageLocation, Warehouse } from "../domain/entities";
import type { DefinitionQuery } from "../domain/repositories";
import { WarehouseDomainError } from "../domain/errors";
import { normalizeCode, normalizeName, normalizeOptionalText } from "../domain/rules";
import type { WarehouseDependencies, WarehousePermission } from "./ports";

export function fail(code: string, message: string): never {
  throw new WarehouseDomainError(code, message);
}

export interface DefinitionInput { code: string; name: string }
export interface BranchInput extends DefinitionInput { description?: string | null; address?: string | null; phone?: string | null; contactName?: string | null }
export interface WarehouseInput extends DefinitionInput { description?: string | null; address?: string | null }
export interface LocationInput extends DefinitionInput { locationType: LocationType; isStockable?: boolean }

export function definitionFields(input: DefinitionInput) {
  return { code: normalizeCode(input.code), name: normalizeName(input.name) };
}
export function branchFields(input: BranchInput) {
  return {
    ...definitionFields(input),
    description: normalizeOptionalText(input.description, "description"),
    address: normalizeOptionalText(input.address, "address"),
    phone: normalizeOptionalText(input.phone, "phone"),
    contactName: normalizeOptionalText(input.contactName, "contactName"),
  };
}
export function warehouseFields(input: WarehouseInput) {
  return { ...definitionFields(input), description: normalizeOptionalText(input.description, "description"), address: normalizeOptionalText(input.address, "address") };
}
export function validateStatus(status: DefinitionStatus): void {
  if (status !== "active" && status !== "inactive") fail("INVALID_STATUS", "حالة التعريف غير صالحة");
}
export function validateLocationInput(input: LocationInput): void {
  if (!["zone", "shelf", "bin", "other"].includes(input.locationType)) fail("INVALID_LOCATION_TYPE", "نوع الموقع غير صالح");
  if (input.isStockable !== undefined && typeof input.isStockable !== "boolean") fail("INVALID_STOCKABILITY", "قابلية التخزين غير صالحة");
}
export function validateQuery(query: DefinitionQuery): DefinitionQuery {
  if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 || !Number.isSafeInteger((query.page - 1) * query.pageSize)) {
    fail("INVALID_PAGE", "بيانات الصفحة غير صالحة");
  }
  if (query.status !== undefined) validateStatus(query.status);
  return { ...query, search: query.search?.trim() };
}
export function available(existing: Definition | null, currentId: string | undefined, code: "DUPLICATE_CODE" | "DUPLICATE_NAME"): void {
  if (existing && existing.id !== currentId) fail(code, code === "DUPLICATE_CODE" ? "رمز التعريف مستخدم بالفعل" : "الاسم مستخدم بالفعل");
}

export function createWarehouseContext(deps: WarehouseDependencies) {
  function branch(id: string): Branch { return deps.branches.findById(id) ?? fail("BRANCH_NOT_FOUND", "الفرع غير موجود"); }
  function warehouse(id: string): Warehouse { return deps.warehouses.findById(id) ?? fail("WAREHOUSE_NOT_FOUND", "المخزن غير موجود"); }
  function location(id: string): StorageLocation { return deps.locations.findById(id) ?? fail("LOCATION_NOT_FOUND", "الموقع غير موجود"); }
  function read<T>(work: () => T): T {
    deps.access.authorize(deps.access.currentActor(), "read");
    return work();
  }
  function mutate<T extends { readonly id: string }>(permission: WarehousePermission, action: string, work: () => T): T {
    return deps.transaction.run(() => {
      const actor = deps.access.currentActor();
      deps.access.authorize(actor, permission);
      const result = work();
      deps.audit.record(actor, action, result.id);
      return result;
    });
  }
  function newDefinition() {
    const now = deps.clock.nowIso();
    return { id: deps.ids.next(), status: "active" as const, version: 1, createdAt: now, updatedAt: now };
  }
  function edited<T extends Definition>(current: T): T {
    if (!Number.isSafeInteger(current.version + 1)) fail("VERSION_CONFLICT", "رقم الإصدار يتجاوز الحد المسموح");
    return { ...current, version: current.version + 1, updatedAt: deps.clock.nowIso() };
  }
  function saved<T>(value: T, success: boolean): T {
    if (!success) fail("VERSION_CONFLICT", "تم تعديل البيانات، أعد تحميلها أولًا");
    return value;
  }
  function assertUnlocked(ids: readonly string[]) {
    if (deps.usage.lockedLocationIds(ids).size) fail("COUNT_ACTIVE", "يوجد جرد مفتوح في النطاق المتأثر");
  }
  function warehouseLocations(id: string) { return deps.locations.listByWarehouse(id); }
  return { deps, branch, warehouse, location, read, mutate, newDefinition, edited, saved, assertUnlocked, warehouseLocations };
}
export type WarehouseContext = ReturnType<typeof createWarehouseContext>;
