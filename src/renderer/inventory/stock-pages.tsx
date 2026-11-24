import { useState } from "react";
import { Link } from "react-router-dom";
import { stockItemSchema } from "../../shared/inventory/schemas";
import { inventoryLink, useInventoryFilters, BalanceTable, ItemChoice, ItemLink, LocationChoice, Quantity, RequestView, WarehouseChoice } from "./shared";
import { compareIds } from "./directory";
import { useInventoryRequest } from "./request";
import { DataTable, FilterBar, Notice, PageTitle, SearchField, StatusBadge } from "../ui";

export function InventoryOverview() {
  const { directory, itemId, locationId, update } = useInventoryFilters();
  const place = directory.locations.get(locationId);
  const validItem = !itemId || stockItemSchema.safeParse({ itemId }).success;
  const key = validItem && itemId && place?.isStockable ? JSON.stringify([itemId, locationId]) : null;
  const request = useInventoryRequest(key, () => window.warehouse.inventory.getAvailableQuantity({ itemId, locationId }));
  return <>
    <PageTitle title="نظرة عامة على المخزون" description="اعرض الرصيد الفعلي والكمية المتاحة لصنف في موقع تخزين محدد." />
    <FilterBar wide>
      <ItemChoice directory={directory} value={itemId} onChange={item => update({ item })} />
      <LocationChoice directory={directory} value={locationId} onChange={location => update({ location })} />
    </FilterBar>
    {!validItem && <Notice kind="error">معرّف صنف المخزون غير صالح.</Notice>}
    {locationId && !place?.isStockable && <Notice kind="error">موقع التخزين غير معروف أو غير قابل للتخزين.</Notice>}
    <RequestView request={request} idle="اختر صنفًا وموقعًا لعرض الكميات.">{data => {
      const unit = directory.units.get(data.baseUnitId)?.name ?? data.baseUnitId;
      return <dl className="panel inventory-metrics">
        <div><dt>الرصيد الفعلي</dt><dd><Quantity value={data.onHand} /></dd></div>
        <div><dt>الكمية المتاحة</dt><dd><Quantity value={data.available} /></dd></div>
        <div><dt>الوحدة الأساسية</dt><dd><bdi>{unit}</bdi></dd></div>
      </dl>;
    }}</RequestView>
    <div className="warehouse-toolbar">
      <Link className="button button-secondary" to={inventoryLink("balances", { item: itemId, warehouse: place?.warehouseId, location: locationId })}>عرض الأرصدة</Link>
      <Link className="button button-secondary" to={inventoryLink("history", { item: itemId, location: locationId })}>عرض سجل الحركات</Link>
      <Link className="button button-secondary" to={inventoryLink("consistency", { item: itemId, location: locationId })}>التحقق من الرصيد</Link>
    </div>
  </>;
}

export function StockBalances() {
  const { directory, itemId, warehouseId, locationId, update } = useInventoryFilters();
  const place = directory.locations.get(locationId);
  const validItem = !itemId || stockItemSchema.safeParse({ itemId }).success;
  const validWarehouse = !warehouseId || directory.warehouses.has(warehouseId);
  const validLocation = !locationId || (place?.isStockable && (!warehouseId || place.warehouseId === warehouseId));
  const key = validItem && validWarehouse && validLocation && itemId ? JSON.stringify([itemId, locationId]) : null;
  const request = useInventoryRequest(key, async () => {
    const api = window.warehouse.inventory;
    if (locationId) {
      const balance = await api.getStockBalance({ itemId, locationId });
      return { baseUnitId: balance.baseUnitId, balances: [balance] };
    }
    return api.getStockItemStock({ itemId });
  });
  return <>
    <PageTitle title="أرصدة المخزون" description="اختر صنفًا واعرض أرصدته حسب المخزن والموقع." />
    <FilterBar wide>
      <ItemChoice directory={directory} value={itemId} onChange={item => update({ item })} />
      <WarehouseChoice directory={directory} optional value={warehouseId} onChange={warehouse => update({ warehouse, location: "" })} />
      <LocationChoice directory={directory} warehouseId={warehouseId} optional value={locationId} onChange={location => update({ location })} />
    </FilterBar>
    {(!validItem || !validWarehouse || !validLocation) && <Notice kind="error">الصنف أو المخزن أو الموقع المحدد غير صالح. راجع عوامل التصفية.</Notice>}
    <RequestView request={request} idle={!itemId ? "اختر صنفًا لعرض أرصدته." : undefined}>{data =>
      <BalanceTable directory={directory} unit={directory.units.get(data.baseUnitId)?.name ?? data.baseUnitId}
        rows={data.balances.filter(row => !warehouseId || row.warehouseId === warehouseId)} linkLocations={!locationId} />
    }</RequestView>
  </>;
}

export function StockItemDetails() {
  const { directory, itemId, update } = useInventoryFilters();
  const validItem = !itemId || stockItemSchema.safeParse({ itemId }).success;
  const request = useInventoryRequest(validItem && itemId ? itemId : null, () => window.warehouse.inventory.getStockItemStock({ itemId }));
  return <>
    <PageTitle title="المخزون حسب الصنف" description="إجمالي رصيد الصنف وتوزيعه على مواقع التخزين." />
    <FilterBar wide><ItemChoice directory={directory} value={itemId} onChange={item => update({ item })} /></FilterBar>
    {!validItem && <Notice kind="error">معرّف صنف المخزون غير صالح.</Notice>}
    <RequestView request={request} idle={!itemId ? "اختر صنفًا لعرض تفاصيل مخزونه." : undefined}>{data => {
      const item = directory.items.get(data.itemId);
      const unit = directory.units.get(data.baseUnitId)?.name ?? data.baseUnitId;
      return <>
        <div className="warehouse-toolbar">
          <h3>{item ? <>{item.name} · <bdi>{item.sku}</bdi></> : <bdi>{data.itemId}</bdi>}</h3>
          <Link className="button button-secondary" to={inventoryLink("history", { item: data.itemId })}>سجل حركات الصنف</Link>
        </div>
        <dl className="panel inventory-metrics">
          <div><dt>إجمالي الرصيد الفعلي</dt><dd><Quantity value={data.onHand} /></dd></div>
          <div><dt>الوحدة الأساسية</dt><dd><bdi>{unit}</bdi></dd></div>
        </dl>
        <BalanceTable directory={directory} rows={data.balances} unit={unit} showItem={false} />
      </>;
    }}</RequestView>
  </>;
}

export function WarehouseInventory() {
  const { directory, warehouseId, update } = useInventoryFilters();
  const [search, setSearch] = useState("");
  const site = directory.warehouses.get(warehouseId);
  const request = useInventoryRequest(site ? warehouseId : null, () => window.warehouse.inventory.getWarehouseStock({ warehouseId }));
  return <>
    <PageTitle title="المخزون حسب المخزن" action={site && <Link className="button button-secondary" to={`/warehouses/${encodeURIComponent(site.id)}/locations`}>مواقع التخزين</Link>} />
    <FilterBar wide>
      <WarehouseChoice directory={directory} value={warehouseId} onChange={warehouse => { setSearch(""); update({ warehouse }); }} />
      <SearchField label="بحث في الأصناف" placeholder="اسم الصنف أو رمزه" value={search} onChange={setSearch} />
    </FilterBar>
    {warehouseId && !site && <Notice kind="error">المخزن المحدد غير موجود.</Notice>}
    <RequestView request={request} idle={!warehouseId ? "اختر مخزنًا لعرض مخزونه." : undefined}>{data => {
      const term = search.trim().toLocaleLowerCase();
      const items = data.items.filter(({ itemId }) => {
        const item = directory.items.get(itemId);
        return [itemId, item?.name, item?.sku].some(value => value?.toLocaleLowerCase().includes(term));
      }).sort((a, b) => compareIds(a.itemId, b.itemId));
      return <>
        <div className="warehouse-toolbar"><h3>{site?.name}</h3>{site && <StatusBadge status={site.status} />}</div>
        <h3>إجمالي الرصيد لكل صنف</h3>
        <DataTable rows={items} rowKey={row => row.itemId} empty={term ? "لا توجد أصناف تطابق البحث." : "لا توجد أرصدة في هذا المخزن."}
          columns={[
            { key: "item", header: "الصنف", render: row => <ItemLink itemId={row.itemId} directory={directory} /> },
            { key: "total", header: "إجمالي الرصيد الفعلي", render: row => <Quantity value={row.onHand} /> },
            { key: "unit", header: "الوحدة الأساسية", render: row => directory.items.get(row.itemId)?.unit ?? "—" },
          ]} />
        {!!items.length && <>
          <h3>الأرصدة حسب الموقع</h3>
          <BalanceTable directory={directory} rows={items.flatMap(item => item.balances)} />
        </>}
      </>;
    }}</RequestView>
  </>;
}
