import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const code = z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(120);
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const status = z.enum(["active", "inactive"]);
const expectedVersion = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const definition = { code, name };
const branch = { ...definition, description: text(2000), address: text(500), phone: text(40), contactName: text(120) };
const warehouse = { ...definition, description: text(2000), address: text(500) };
const location = { ...definition, locationType: z.enum(["zone", "shelf", "bin", "other"]), isStockable: z.boolean().optional() };
const pagination = {
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(), status: status.optional(),
};

export const idRequest = z.object({ id }).strict();
export const branchCreate = z.object(branch).strict();
export const branchUpdate = z.object({ ...branch, id, expectedVersion }).strict();
export const branchList = z.object(pagination).strict();
export const setStatus = z.object({ id, status, expectedVersion }).strict();
export const warehouseCreate = z.object({ ...warehouse, branchId: id }).strict();
export const warehouseUpdate = z.object({ ...warehouse, id, expectedVersion }).strict();
export const warehouseList = z.object({ ...pagination, branchId: id.optional() }).strict();
export const warehouseReassign = z.object({ id, branchId: id, expectedVersion }).strict();
export const locationCreate = z.object({ ...location, warehouseId: id, parentId: id.nullable().optional() }).strict();
export const locationUpdate = z.object({ ...location, id, expectedVersion }).strict();
export const locationList = z.object({ ...pagination, warehouseId: id }).strict();
export const locationTree = z.object({ warehouseId: id, parentId: id.nullable().optional() }).strict();
export const locationReparent = z.object({ id, parentId: id.nullable(), expectedVersion }).strict();
export const stockableList = z.object({ warehouseId: id.optional() }).strict().default({});
