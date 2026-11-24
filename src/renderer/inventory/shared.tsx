import type { ReactNode } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import type { LocationStock } from "../../shared/inventory/types";
import { Button, DataTable, EmptyState, LoadingState, Notice, StatusBadge, type DataColumn } from "../ui";
import type { InventoryDirectory } from "./directory";
import { compareIds } from "./directory";
import type { InventoryRequest } from "./request";

type Filters = { item?: string; warehouse?: string; location?: string };
type View = "balances" | "items" | "warehouses" | "history" | "consistency";

export function inventoryLink(view: View, filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return `/inventory/${view}${query ? `?${query}` : ""}`;
}

export function useInventoryFilters() {
  const directory = useOutletContext<InventoryDirectory>();
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item") ?? "";
  const warehouseId = params.get("warehouse") ?? "";
  const locationId = params.get("location") ?? "";
  function update(filters: Filters) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(filters)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  }
  return { directory, itemId, warehouseId, locationId, update };
}

export function Choice({ label, value, options, placeholder, onChange }: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  placeholder: string;
  onChange: (id: string) => void;
}) {
  return <label>
    {label}
    <select value={value} disabled={!options.length && !value} onChange={event => onChange(event.target.value)}>
      <option value="">{options.length ? placeholder : "لا توجد خيارات متاحة"}</option>
      {value && !options.some(option => option.id === value) && <option value={value} disabled>اختيار غير معروف</option>}
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
}

export function ItemChoice({ directory, value, onChange }: {
  directory: InventoryDirectory; value: string; onChange: (id: string) => void;
}) {
  return <Choice label="الصنف" value={value} onChange={onChange} placeholder="اختر صنفًا"
    options={Array.from(directory.items.values(), item => ({ id: item.id, label: `${item.name} · ${item.sku}` }))} />;
}

export function WarehouseChoice({ directory, value, optional, onChange }: {
  directory: InventoryDirectory; value: string; optional?: boolean; onChange: (id: string) => void;
}) {
  return <Choice label="المخزن" value={value} onChange={onChange} placeholder={optional ? "كل المخازن" : "اختر مخزنًا"}
    options={Array.from(directory.warehouses.values(), site => ({ id: site.id, label: `${site.name} · ${site.code}` }))} />;
}

export function LocationChoice({ directory, value, warehouseId, optional, onChange }: {
  directory: InventoryDirectory; value: string; warehouseId?: string; optional?: boolean; onChange: (id: string) => void;
}) {
  const options = Array.from(directory.locations.values())
    .filter(place => place.isStockable && (!warehouseId || place.warehouseId === warehouseId))
    .map(place => ({
      id: place.id,
      label: `${directory.warehouses.get(place.warehouseId)?.name ?? place.warehouseId} · ${place.name} · ${place.code}${place.status === "inactive" ? " (غير نشط)" : ""}`,
    }));
  return <Choice label="الموقع" value={value} onChange={onChange} options={options}
    placeholder={optional ? "كل المواقع" : "اختر موقعًا"} />;
}

export function RequestView<T>({ request, idle, children }: {
  request: { state: InventoryRequest<T>; retry: () => void };
  idle?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  const { state, retry } = request;
  if (state.status === "idle") return idle ? <EmptyState>{idle}</EmptyState> : null;
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <Notice kind="error">{state.message} <Button onClick={retry}>إعادة المحاولة</Button></Notice>;
  return <>{children(state.data)}</>;
}

export function Quantity({ value, signed = false }: { value: string | null; signed?: boolean }) {
  if (value === null) return <span>لا يوجد رصيد مسجّل</span>;
  const negative = signed && value.startsWith("-");
  const positive = signed && !negative && /[1-9]/.test(value);
  return <bdi dir="ltr" className={`inventory-quantity${negative ? " inventory-negative" : positive ? " inventory-positive" : ""}`}>
    {positive ? `+${value}` : value}
  </bdi>;
}

export function ItemLink({ directory, itemId }: { directory: InventoryDirectory; itemId: string }) {
  const item = directory.items.get(itemId);
  return <>
    <Link className="table-link" to={inventoryLink("items", { item: itemId })}>{item?.name ?? <bdi>{itemId}</bdi>}</Link>
    {item && <small className="inventory-row-secondary"><bdi>{item.sku}</bdi></small>}
  </>;
}

export function LocationLink({ directory, row, link = true }: {
  directory: InventoryDirectory; row: { itemId: string; locationId: string }; link?: boolean;
}) {
  const location = directory.locations.get(row.locationId);
  const name = location ? `${location.name} · ${location.code}` : <bdi>{row.locationId}</bdi>;
  return <>
    {link && location?.isStockable
      ? <Link className="table-link" to={inventoryLink("balances", { item: row.itemId, warehouse: location.warehouseId, location: row.locationId })}>{name}</Link>
      : name}
    {location?.status === "inactive" && <span className="inventory-row-secondary"><StatusBadge status="inactive" /></span>}
  </>;
}

export type BalanceRow = Omit<LocationStock, "onHand"> & { onHand: string | null };

export function orderBalances<T extends BalanceRow>(rows: T[]) {
  return [...rows].sort((a, b) => compareIds(a.warehouseId, b.warehouseId) || compareIds(a.itemId, b.itemId)
    || compareIds(a.locationId, b.locationId));
}

export function BalanceTable({ directory, rows, unit, showItem = true, linkLocations = true }: {
  directory: InventoryDirectory; rows: BalanceRow[]; unit?: string; showItem?: boolean; linkLocations?: boolean;
}) {
  const columns: DataColumn<BalanceRow>[] = [
    { key: "warehouse", header: "المخزن", render: row => (
      <Link className="table-link" to={inventoryLink("warehouses", { warehouse: row.warehouseId })}>
        {directory.warehouses.get(row.warehouseId)?.name ?? <bdi>{row.warehouseId}</bdi>}
      </Link>
    ) },
    { key: "location", header: "الموقع", render: row => <LocationLink directory={directory} row={row} link={linkLocations} /> },
    { key: "onHand", header: "الرصيد الفعلي", render: row => <Quantity value={row.onHand} /> },
    { key: "unit", header: "الوحدة الأساسية", render: row => unit ?? directory.items.get(row.itemId)?.unit ?? "—" },
  ];
  if (showItem) columns.unshift({
    key: "item", header: "الصنف", render: row => <ItemLink directory={directory} itemId={row.itemId} />,
  });
  return <DataTable columns={columns} rows={orderBalances(rows)}
    rowKey={row => JSON.stringify([row.itemId, row.locationId])} empty="لا توجد أرصدة ضمن هذا النطاق." />;
}
