import type { WarehouseApi } from "../../shared/ipc/contracts";
import type { StorageLocationDto } from "../../shared/warehouses/types";

type Page<T> = { items: readonly T[]; total: number };

async function readPages<T>(list: (page: number, pageSize: number) => Promise<Page<T>>, signal: AbortSignal) {
  const records: T[] = [];
  for (let page = 1; ; page++) {
    signal.throwIfAborted();
    const result = await list(page, 100);
    records.push(...result.items);
    if (records.length >= result.total || !result.items.length) return records;
  }
}

function indexById<T extends { id: string }>(records: readonly T[]) {
  return new Map(records.map(record => [record.id, record]));
}

export async function loadInventoryDirectory(api: WarehouseApi, signal: AbortSignal) {
  const { catalog, warehouses } = api;
  const [products, variants, units, sites] = await Promise.all([
    catalog.products.lookup(),
    readPages((page, pageSize) => catalog.variants.list({ page, pageSize }), signal),
    catalog.units.lookup(),
    readPages((page, pageSize) => warehouses.warehouses.list({ page, pageSize }), signal),
  ]);
  const unitsById = indexById(units);
  const items = [
    ...products.filter(product => product.productType === "simple").map(product => ({
      id: `p:${product.id}`, name: product.name, sku: product.sku,
      unit: unitsById.get(product.baseUnitId)?.name ?? product.baseUnitId,
    })),
    ...variants.map(variant => ({
      id: `v:${variant.id}`, name: `${variant.productName} / ${variant.name}`,
      sku: variant.sku, unit: variant.baseUnitName,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku) || compareIds(a.id, b.id));

  const locations: StorageLocationDto[] = [];
  // Location listing is warehouse-scoped. Read pages of definitions without an active-status filter.
  for (const warehouse of sites) {
    locations.push(...await readPages(
      (page, pageSize) => warehouses.locations.list({ warehouseId: warehouse.id, page, pageSize }), signal,
    ));
  }

  return {
    items: indexById(items),
    warehouses: indexById(sites),
    locations: indexById(locations),
    units: unitsById,
  };
}

export type InventoryDirectory = Awaited<ReturnType<typeof loadInventoryDirectory>>;

export function compareIds(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
