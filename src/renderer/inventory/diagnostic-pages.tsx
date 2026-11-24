import { useState } from "react";
import { Link } from "react-router-dom";
import { stockItemSchema } from "../../shared/inventory/schemas";
import type { InventoryDirectory } from "./directory";
import { useInventoryRequest } from "./request";
import { inventoryLink, useInventoryFilters, ItemChoice, LocationChoice, LocationLink, Quantity, RequestView } from "./shared";
import { Button, DataTable, EmptyState, FilterBar, Notice, PageTitle } from "../ui";

const HISTORY_PAGE_SIZE = 50;

export function InventoryHistory() {
  const { directory, itemId, locationId, update } = useInventoryFilters();
  const validItem = !itemId || stockItemSchema.safeParse({ itemId }).success;
  const validLocation = !locationId || directory.locations.get(locationId)?.isStockable;
  return <>
    <PageTitle title="سجل حركات المخزون" description="راجع حركات الصنف من الأحدث إلى الأقدم." />
    <FilterBar wide>
      <ItemChoice directory={directory} value={itemId} onChange={item => update({ item })} />
      <LocationChoice directory={directory} value={locationId} optional onChange={location => update({ location })} />
    </FilterBar>
    {(!validItem || !validLocation) && <Notice kind="error">معرّف الصنف أو الموقع المحدد غير صالح.</Notice>}
    {!itemId && <EmptyState>اختر صنفًا لعرض حركاته.</EmptyState>}
    {validItem && validLocation && itemId && <>
      <div className="warehouse-toolbar">
        <Link className="button button-secondary" to={inventoryLink("items", { item: itemId })}>تفاصيل مخزون الصنف</Link>
      </div>
      <HistoryResults key={JSON.stringify([itemId, locationId])} directory={directory} itemId={itemId} locationId={locationId} />
    </>}
  </>;
}

function HistoryResults({ directory, itemId, locationId }: {
  directory: InventoryDirectory; itemId: string; locationId: string;
}) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const beforeMovementId = cursors[cursors.length - 1];
  const request = useInventoryRequest(JSON.stringify([itemId, locationId, beforeMovementId]), () => (
    window.warehouse.inventory.getInventoryHistory({
      itemId, limit: HISTORY_PAGE_SIZE,
      ...(locationId ? { locationId } : {}),
      ...(beforeMovementId === undefined ? {} : { beforeMovementId }),
    })
  ));
  const next = request.state.status === "success" ? request.state.data.nextBeforeMovementId : null;

  return <>
    <RequestView request={request}>{data => <DataTable rows={data.movements} rowKey={row => row.movementId}
      empty="لا توجد حركات مخزون ضمن هذا النطاق."
      columns={[
        { key: "movement", header: "معرّف الحركة", render: row => <bdi>{row.movementId}</bdi> },
        { key: "document", header: "معرّف مستند المخزون", render: row => <bdi>{row.documentId}</bdi> },
        { key: "location", header: "الموقع", render: row => <LocationLink directory={directory} row={row} /> },
        { key: "delta", header: "التغيّر بالوحدة الأساسية", render: row => <Quantity value={row.delta} signed /> },
      ]} />}</RequestView>
    <nav className="pagination" aria-label="صفحات سجل الحركات">
      <span>
        {request.state.status === "success" && `عدد الحركات في الصفحة ${request.state.data.movements.length}`}
      </span>
      <div>
        <Button disabled={cursors.length === 1} onClick={() => setCursors(cursors.slice(0, -1))}>السابق</Button>
        <span aria-live="polite">صفحة {cursors.length}</span>
        <Button disabled={next === null} onClick={() => { if (next !== null) setCursors([...cursors, next]); }}>التالي</Button>
      </div>
    </nav>
  </>;
}

export function BalanceConsistency() {
  const { directory, itemId, locationId, update } = useInventoryFilters();
  const place = directory.locations.get(locationId);
  const validItem = !itemId || stockItemSchema.safeParse({ itemId }).success;
  const validLocation = !locationId || place?.isStockable;
  return <>
    <PageTitle title="التحقق من اتساق الرصيد" description="قارن الرصيد المسجّل برصيد سجل الحركات لصنف في موقع محدد." />
    <FilterBar wide>
      <ItemChoice directory={directory} value={itemId} onChange={item => update({ item })} />
      <LocationChoice directory={directory} value={locationId} onChange={location => update({ location })} />
    </FilterBar>
    {(!validItem || !validLocation) && <Notice kind="error">معرّف الصنف أو الموقع المحدد غير صالح.</Notice>}
    <ConsistencyCheck key={JSON.stringify([itemId, locationId])} directory={directory} itemId={itemId} locationId={locationId}
      canVerify={Boolean(validItem && itemId && locationId && validLocation)} />
  </>;
}

function ConsistencyCheck({ directory, itemId, locationId, canVerify }: {
  directory: InventoryDirectory; itemId: string; locationId: string; canVerify: boolean;
}) {
  const [check, setCheck] = useState(0);
  const request = useInventoryRequest(canVerify && check ? String(check) : null, () => (
    window.warehouse.inventory.verifyBalanceConsistency({ itemId, locationId })
  ));
  return <>
    <div className="warehouse-toolbar">
      <Button variant="primary" disabled={!canVerify || request.state.status === "loading"}
        onClick={() => setCheck(value => value + 1)}>تحقق من الاتساق</Button>
    </div>
    <RequestView request={request} idle="اختر الصنف والموقع ثم اضغط على «تحقق من الاتساق».">{data => {
      const unit = directory.units.get(data.baseUnitId)?.name ?? data.baseUnitId;
      if (!data.discrepancies.length) return <Notice kind="success">الرصيد المسجّل مطابق لرصيد سجل الحركات.</Notice>;
      return <>
        <Notice kind="error">يوجد اختلاف بين الرصيد المسجّل ورصيد سجل الحركات.</Notice>
        {data.discrepancies.map(({ onHand, ledger }, index) => (
          <dl className="panel inventory-metrics" key={index}>
            <div><dt>الرصيد المسجّل</dt><dd><Quantity value={onHand} /></dd></div>
            <div><dt>رصيد سجل الحركات</dt><dd><Quantity value={ledger} /></dd></div>
            <div><dt>الوحدة الأساسية</dt><dd><bdi>{unit}</bdi></dd></div>
          </dl>
        ))}
      </>;
    }}</RequestView>
  </>;
}
